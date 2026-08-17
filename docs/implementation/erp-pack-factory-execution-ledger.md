# ERP Archetype and Specialized System Pack Factory — execution ledger

Every `PACK-*` requirement stated by `Tenure_ERP_Archetype_and_Specialized_System_Pack_Factory_Claude_Bible_v1.0.md`.

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

- [x] **PACK-000-001** — Inventory every existing module, route, schema, service, feature flag, integration and tenant customization.
  - Status: PASS
  - Code: `tools/pack-surface-inventory.mjs` (the generator),
    `docs/architecture/pack-surface-inventory.json` and
    `docs/architecture/pack-surface-inventory.md` (its two outputs),
    `tests/architecture/pack-surface-inventory.test.mjs` (the guard).
  - What it inventories, and where each section comes from — all seven the
    requirement names, each derived from a source file rather than written out:
    **12 modules** from `modules/index.ts`; **80 routes** (28 API, 52 pages;
    66 tenant, 14 deployer) walked from `apps/web/src/app` and
    `apps/system-studio/src/app`; **52 schema models** from
    `apps/web/prisma/schema.prisma`, 27 of them carrying `institutionId`;
    **18 workspaces** from their own `package.json` files with the `@tenure/*`
    edges between them; **1 feature flag** from
    `packages/platform-config/src/flags.ts`; **24 provider packs** from
    `packages/provisioning/src/provider-packs.ts` with their egress hosts;
    and tenant customization as its three real mechanisms — **11 configuration
    layers** from `packages/configuration/src/layer-schema.ts`, **16
    configuration domains** from `packages/configuration/src/domains.ts` with
    `tenantAdminMayWrite` carried, and **3 blueprints** under `blueprints/`.
  - Why a generator: a hand-written inventory is accurate the day it is written
    and *plausible* from the next commit onward, which is the failure this
    programme keeps hitting. Every row carries a `source` path and the guard
    opens all 107 of them.
  - Cross-checked, not merely listed. Two sections derived independently are
    compared: every model a module claims in `objects` must be a model
    `schema.prisma` declares (38 claims, 0 orphans), and every `href` a module
    advertises must be a page the tenant app serves (10 hrefs, 0 dangling).
    The route counts land on `docs/architecture/entry-points.md`'s independently
    generated "28 API routes · 52 pages" exactly.
  - Byte-identical across checkouts: tracked files only (never `--others`, so
    the document cannot describe whoever's working tree generated it), POSIX
    paths, one fixed comparator for every sort, CRLF collapsed to LF before any
    match or comparison, and no timestamp in the output. Ran the generator twice
    and diffed both artifacts — identical.
  - Tests: `node --test tests/architecture/pack-surface-inventory.test.mjs` →
    6/6 pass. `node tools/pack-surface-inventory.mjs --check` → current.
  - Evidence — 3 mutations applied to the committed inventory, 3 caught, all
    restored to 6/6:
    1. Corrupted one real cited path
       (`packages/provisioning/src/provider-packs.ts` →
       `…-renamed.ts`) → 2 of 6 red: "the committed inventory is what the tree
       now says" and "every path the inventory cites is a file that exists".
    2. Removed one real entry (the `events` module row) → 2 of 6 red: the
       freshness check, and "the human document and the machine document agree",
       because the markdown headline still said 12 modules.
    3. Corrupted one real mapping (`organizations` claims `SeatV2` instead of
       `Seat`) → 2 of 6 red, including "every schema model a module claims is a
       model the database declares".
  - Honest limits: (a) this is an inventory of what EXISTS, not a claim that any
    of it is complete — the per-dimension verdicts are PACK-000-002's job and all
    twelve modules are `certified-limited`; (b) `tools/pack-surface-inventory.mjs`
    is not in the root `generate` script, because `package.json` is shared and
    not this domain's to edit — adding
    `&& node tools/pack-surface-inventory.mjs` to it is the one-line change that
    would make the freshness check regenerate with the others.

- [x] **PACK-000-002** — Classify each capability using the 17-dimension completeness contract.
  - Status: PASS
  - Code: `packages/module-runtime/src/manifest.ts` (`COMPLETENESS_DIMENSIONS`,
    `DimensionAssessment`, `ModuleGap`, `CLAIMS_COMPLETENESS`, and the block of
    `validateManifest` that refuses the claim), `modules/index.ts` (the `assess`
    helper and all twelve classifications).
  - What changed: the availability claim is evidence-gated instead of
    hand-written. Every manifest states all seventeen Bible §6 dimensions with
    a status and an evidence string, and `validateManifest` refuses
    `lifecycle: "available"` or `"approved"` when any dimension is missing or
    is a gap. Nothing is downgraded automatically — the manifest is refused and
    the author states what is true. All twelve came out `certified-limited`,
    which is the state Bible §6 names for a pack missing an applicable
    dimension. 12 modules x 17 dimensions = 204 assessments, 75 of them gaps.
  - Tests: `npx jest --ci module-runtime.test` -> 58/58, including 9 in "an
    availability claim has to be backed by evidence";
    `node --test tests/architecture/module-objects.test.mjs` -> 7/7, one of
    which opens every file any assessment cites.
  - Mutation: marked `budgeting` `available` with its accounting gap standing ->
    `ModuleCatalog.of` threw at import and 5 of 54 tests in
    `platform-config/src/modules.test` failed; restored -> 54/54.
  - Mutation: renamed a cited path to `calendar-writer.ts` ->
    `module-objects.test.mjs` failed on "every file a dimension cites is a file
    that exists"; restored -> 7/7.

- [x] **PACK-000-003** — Import every `PACK-*` requirement into the canonical ledger.
  - Status: PASS
  - Code: `tests/architecture/pack-requirements-imported.test.mjs` — the check
    that makes the import a claim somebody can refute, over the readers already
    owned by `tools/document-graph.mjs`.
  - What was true and what was missing. The import itself was already done —
    `tools/import-requirements.mjs` seeded this ledger and all 53 `PACK-*`
    requirements the Bible states (including the ten `PACK-GATE-*` ids) have a
    row here. What did not exist was a check that could catch it coming undone.
    The global ratchet in `tests/architecture/document-graph.test.mjs` counts
    requirements no execution document mentions and holds it at zero, which is
    necessary and not sufficient: a PACK row that MIGRATED into another domain's
    ledger, or one stated TWICE, moves that count by nothing at all. The first
    hands PACK work to whoever owns the other file; the second lets one
    requirement hold two different statuses. Both are invisible to a total and
    obvious to an equality, so the check asserts the equality across four
    independently derived sets — what the Bible states, what the execution
    system imported, what this ledger owns, and what the generated registry
    resolves back to this Bible.
  - Measured: 53 stated, 53 imported, 53 owned by
    `docs/implementation/erp-pack-factory-execution-ledger.md`, 53 registry rows
    all resolving to the pack Bible, 0 duplicates. Of those 53, 36 are FAIL —
    this proves import and claims nothing about pack behaviour.
  - Tests: `node --test tests/architecture/pack-requirements-imported.test.mjs`
    → 5/5 pass.
  - Evidence — 2 mutations, 2 caught, both restored to 5/5:
    1. Renamed this ledger's `PACK-050-004` row to `PACK-050-999` → 3 of 5 red:
       "every PACK requirement is in the execution system", "…owned by the pack
       ledger", and "…exactly once".
    2. Duplicated the `PACK-050-004` row inside this ledger, the second copy
       claiming PASS → 1 of 5 red: "the pack ledger states each PACK requirement
       exactly once". The global unimported ratchet in
       `tests/architecture/document-graph.test.mjs` does NOT move under this
       second mutation: with the duplicate row in place, the "unimported
       count only shrinks" assertion stayed green, because both copies are
       imported. That is exactly why this check exists separately from it.
       The ratchet does move under the first mutation.
  - Honest limit: import is not progress. This entry closes the wiring item
    only — that every `PACK-*` requirement is visible to the one execution
    system and owned by this file, so the loop cannot skip a requirement while
    the denominator still looks plausible.

- [x] **PACK-000-004** — Remove or relabel false `Available` claims.
  - Status: PASS
  - Code/config: `modules/index.ts` (twelve manifests relabelled
    `certified-limited` with all seventeen dimensions stated),
    `packages/module-runtime/src/manifest.ts` (`validateManifest` refuses
    `available` while any dimension is a gap),
    `tests/architecture/nav-hrefs-are-served.test.mjs`,
    `tools/entry-point-inventory.mjs`,
    `apps/system-studio/src/app/tenants/new/page.tsx`,
    `apps/system-studio/src/app/tenants/new/ComposeForm.tsx`
  - Three separate falsehoods, all closed:
    1. **The label.** All twelve manifests hardcoded `lifecycle: "available"`.
       They now state seventeen dimension assessments each and come out
       `certified-limited`; the validator refuses `available` for any manifest
       carrying a gap, so the label cannot be re-asserted by editing one line.
    2. **The check that could not refute it.**
       `packages/platform-config/src/modules.test.ts:112-131` compared nav hrefs
       against a `const served = new Set([...])` written by hand in the same
       file. Deleting `apps/web/src/app/(app)/reports/page.tsx` left it green.
       Replaced by `tests/architecture/nav-hrefs-are-served.test.mjs`, which
       derives the served routes from `collect().pages` in
       `tools/entry-point-inventory.mjs` and names no route itself.
    3. **The Studio offering it anyway.** `tenants/new/page.tsx:30-34` mapped
       `MODULE_CATALOG.all()` for the composer and dropped `lifecycle`, so a
       module in `development` or `retired` was a plain selectable checkbox with
       no state shown — an `Available` claim made by omission, against bible
       §5:151-176. `lifecycle` is carried through and rendered, and `enableable`
       is computed from the same `ENABLEABLE` set the resolver refuses with
       rather than from a second list; a module outside it renders disabled with
       "Cannot be enabled: lifecycle is …".
  - Tests: `node --test tests/architecture/nav-hrefs-are-served.test.mjs` → 3 passed.
  - Evidence — 3 mutations, 3 caught:
    1. `apps/web/src/app/(app)/reports/page.tsx` renamed → the href test FAILS
       naming `budgeting.reports -> /reports`; restored → 3 passed.
    2. `apps/web/src/app/(app)/calendar/page.tsx` renamed → FAILS naming
       `events.calendar -> /calendar`; restored → 3 passed. Before
       `listFiles` was taught to skip index-only paths this same mutation failed
       with an unrelated `ENOENT`, which is a crash rather than a finding.
    3. `search` set to `lifecycle: "development"` → `ENABLEABLE.has(...)` is
       `false`, so the Studio checkbox renders disabled, and the server refuses
       the same module independently: `resolveModules` returns keys
       `["dashboard","organizations"]` and problem `search:not-enableable`.
       Restored → `certified-limited`, enableable, resolved with no problems.
  - Not covered by an automated test: that the *rendered* checkbox carries
    `disabled`. The Studio's Playwright suite needs a running instance with an
    operator allowlist and secret (`apps/system-studio/playwright.config.ts` has
    no `webServer` block, deliberately), which this run had no credentials for.
    The value it renders from is the one asserted above.

- [ ] **PACK-010-001** — Enforce one platform kernel for tenant, identity, authorization, configuration, workflow, audit, files, events, ledger, integration, Relay and lifecycle.
  - Status: FAIL
  - **Re-judged, and the FAIL stands.** The orchestrator left this FAIL so a
    different reader would decide it rather than the person who fixed it. This
    is that reading, done without re-running the prior mutations, because the
    thing that decides this item is not whether four mutations reproduce — it is
    whether the requirement's own enumeration is satisfied, and it is not.
    - The two claims I could check without mutating shared source both hold.
      The proof that was recorded as caught and was not is now real:
      `apps/web/src/lib/relay-tools.test.ts:252` asserts
      `roch.offered[0].decision.policyRevision` equals
      `policyRevisionOf(worldOf("rochester"))` — the value `decideCheck`
      actually emits, not the helper called directly, which is what a frozen
      constant satisfied. `apps/web/src/lib/s3.ts:3,111` imports and re-parses
      `FileRef` on the way in, so the file contract is reached by production.
    - What refuses the PASS: the requirement enumerates TWELVE concerns, and
      `packages/contracts/src/index.ts` — the file this entry names as the
      kernel boundary — declares a contract for nine of them and for **ledger,
      integration and lifecycle it declares nothing at all**. Grepping its
      exported declarations returns `TenantContext`, `Command`, `Query`,
      `DomainEvent`, `OutboxRecord`, `JobRequest`, `IdempotencyRecord`,
      `PermissionCheck`, `PermissionDecision`, `FileRef`, `ConfigSnapshot`,
      `AuditEntry`, `ToolRegistration`, `ProcessChain` and the Studio
      control-plane shapes; `ledger` appears in no exported name and neither
      does any integration or connector envelope. The entry's own closing
      paragraph says as much. A kernel that has no shape for a concern cannot
      be the one kernel for it, and there is no PARTIAL — so this is FAIL, not
      a PASS with a footnote.
  - Not BLOCKED_EXTERNAL: nothing external is missing. The work is a ledger and
    an integration contract in `packages/contracts/src/index.ts` plus a
    production producer and consumer for each, on the pattern the five closed
    contracts already set. It is deferred rather than blocked because that file
    is the shared kernel boundary the FIN (`FIN-000-003`, immutable balanced
    journal) and INT (`INT-000-001/002`) domains are working in during the same
    wave, and two agents inventing two ledger envelopes in one file is the
    parallel-foundation defect this requirement exists to forbid. Sequence it
    after those domains have declared their shapes, then wire the kernel
    contract to them.
  - Reclassified from PASS by the orchestrator, on its refuter's verdict. Four
    contracts were claimed proven by mutation; three reproduce exactly, and the
    fourth did not exist — the suite stayed green under it. A requirement whose
    reported proof for one of its five contracts is not real is not PASS, however
    good the other four are, and the refuter's own report says the rest checks
    out. The missing proof has since been built (see mutation 4 below) and the
    mutation is caught now, but the entry is left FAIL so it returns to the queue
    and is re-judged by a refuter rather than promoted by the person who fixed it.
  - What was actually wrong: `packages/contracts/src/index.ts` declared fourteen
    contracts as the kernel boundary and five of them were reached by nothing
    outside the package — `JobRequest`, `PermissionCheck`, `PermissionDecision`,
    `FileRef` and `ConfigSnapshot`. Meanwhile the real code for those concerns
    used its own shapes: files were a bare `key: string`, authorization returned
    `@tenure/authorization`'s `Decision`, configuration returned
    `@tenure/configuration`'s `ResolvedConfig`, and the reminder job read no
    envelope at all. Two shapes per concern is the drift "one kernel" exists to
    prevent, and the ownership map counted the declarations as coverage.
  - All five now have a production producer AND a production consumer:
    - `FileRef` — `apps/web/src/lib/s3.ts` (`fileRef` produces, `uploadDocument`
      accepts and re-parses), consumed by all six upload paths:
      `orgs/[slug]/documents/actions.ts`, `orgs/[slug]/finance/actions.ts`,
      `api/documents/[id]/save/route.ts`, `orgs/actions.ts`,
      `settings/actions.ts`, `messages/actions.ts`.
    - `PermissionCheck` / `PermissionDecision` — `decideCheck` and
      `policyRevisionOf` in `packages/authorization/src/decide.ts`, consumed by
      `apps/web/src/lib/relay-tools.ts`, which the AI chat route calls per
      request.
    - `ConfigSnapshot` — `configSnapshotForInstitution` in
      `apps/web/src/lib/config/server.ts`, consumed by
      `apps/web/src/app/api/ai/chat/route.ts` for the `TenantContext`'s
      `configRevision`.
    - `JobRequest` — `jobRequestFrom` in
      `apps/web/src/app/api/jobs/reminders/route.ts`, which refuses an attempt
      beyond the job's own limit instead of re-sending deadline reminders.
  - Behaviour that changed, not just shape: three of the five upload paths minted
    object keys with **no tenant prefix at all** (`profile-images/…`,
    `org-images/…`, `message-attachments/…`). `parseFileRef` refuses those, so
    all three now mint tenant-prefixed keys. Reads are unaffected — they take the
    key stored on the row, so objects written before this keep resolving.
  - The contract that had to be fixed rather than worked around:
    `PermissionCheck.permission` required exactly two dotted segments, and every
    key this platform ships has three (`search.index.query`,
    `finance.budget.read`). A rule no real value can satisfy is why nothing
    produced one. It now requires at least one dot; a bare word is still refused.
  - Code: `packages/contracts/src/index.ts`,
    `packages/authorization/src/decide.ts`, `apps/web/src/lib/s3.ts`,
    `apps/web/src/lib/config/server.ts`, `apps/web/src/lib/relay-tools.ts`,
    `apps/web/src/app/api/jobs/reminders/route.ts`
  - Tests: `apps/web/src/lib/s3.test.ts` (7),
    `apps/web/src/lib/config/config-snapshot.test.ts` (4),
    `apps/web/src/app/api/jobs/reminders/job-request.test.ts` (5),
    `apps/web/src/lib/relay-tools.test.ts` (8),
    `packages/contracts/src/contracts.test.ts` (ProcessChain + three-segment
    permission keys)
  - Mutations, 4 applied, 4 caught, all restored:
    1. `fileRef` produces a ref with `tenantId: undefined` → 4 of 7 s3 tests red
       with `ContractViolation: FileRef.tenantId: expected a string, got
       undefined`. Restored → 7/7.
    2. `configSnapshotForInstitution` returns `""` for an unbound tenant's
       revision → `says platform-defaults for an institution nothing has bound`
       red with `ConfigSnapshot.revision: must not be empty`. Restored → 4/4.
    3. `jobRequestFrom` clamps `attempt` to 1 instead of reading the scheduler's
       → 3 of 5 job tests red, including `refuses an attempt beyond the job's own
       limit, without sweeping`. Restored → 5/5.
    4. `policyRevision` becomes the constant `"pol-00000000"` → **this was
       recorded as caught and it was not**. A refuter re-ran it and the whole
       apps/web suite stayed green, `relay-tools.test.ts` included, because the
       test proved the property against `policyRevisionOf` called directly and
       the only assertion on the value `decideCheck` actually emits was the shape
       `/^pol-[0-9a-f]{8}$/`, which a frozen constant satisfies. `decideCheck` is
       the sole production caller, so nothing was watching the producer.
       `relay-tools.test.ts` now asserts the emitted revision equals
       `policyRevisionOf(worldOf("rochester"))`; re-run of the same mutation →
       1 of 8 red, restored → 8/8. The mutation is caught now. It was not then,
       and this line said otherwise.
  - Evidence: `npm run type-check` 0 errors;
    `npm run test --workspace apps/web -- --ci` 3448/3448 across 137 suites.
  - Honest scope: this closes the five unwired contracts. It does not claim the
    twelve concerns the requirement enumerates are each fully built — `ledger`
    and `integration` have no kernel contract at all, which is a gap this entry
    does not paper over.

- [x] **PACK-010-002** — Define guarded extension points and dependency rules.
  - Status: PASS
  - REGRESSION found and fixed by the orchestrator after the refuter confirmed
    this. Changing `dependsOn` from `readonly string[]` to
    `{module, kind}[]` — where `module` may name a CAPABILITY another module
    supplies via `provides` — made `provides` load-bearing for
    `moduleGraphRejections`. Three call sites in
    `apps/system-studio/src/app/tenants/[slug]/configuration/actions.ts` project
    `MODULES` to `{key, dependsOn, entitlement}` and dropped it, so every plan
    returned `invalid-reference: Module "reimbursements" depends on
    "finance.ledger", which is not in the catalogue`, `planPublication` set
    `blocked: true`, and the Studio's Publish button never enabled — **no
    configuration could be published, for any tenant, for any change**.
  - Proven by isolation, not inference: `config-store.spec.ts` passes at clean
    HEAD against the same DynamoDB table and fails with this change; probing
    `moduleGraphRejections` with the Studio's exact projection returns that one
    rejection, and with `provides` carried through returns `[]`.
  - `provides` now carried at all three sites. Studio Playwright 185/185 on a
    pristine registry table. Guarded by
    `tests/architecture/module-graph-callers-carry-provides.test.mjs`; mutation:
    drop `provides` from one site → 2 pass 1 fail, restored → 3 pass 0 fail.
  - `tsc` could not catch this: `provides` is optional on `ModuleLike`, and
    `npm run studio:type-check` passed throughout. Every unit test passed too,
    because they build their own module fixtures. It took the Studio's own
    Playwright suite against a real DynamoDB — the check the handoff recorded as
    impossible to run on this host.
  - Code: `packages/module-runtime/src/manifest.ts` (`ModuleDependency`,
    `DEPENDENCY_KINDS`, `provides`, and the range/kind validation),
    `packages/module-runtime/src/resolve.ts` (`satisfiesRange`,
    `VersionComparator`, `version-out-of-range`),
    `packages/releases/src/validate.ts` (`moduleDependencies`,
    `satisfiesRange`), `packages/platform-config/src/build-system.ts` (the
    caller that supplies both).
  - What changed: a dependency was a bare key with no version, no kind and no
    guarded seam. It is now `{ module, range, kind }` where `module` may name a
    module key OR a namespaced capability another module `provides` — which is
    the guarded extension point Bible §10 asks for: a pack extends another
    through a declared capability rather than by naming its key. Ranges are
    compared numerically through the one comparator the tree owns
    (`compareVersionStrings` in `packages/platform-config/src/compatibility.ts`,
    injected because module-runtime must not import platform-config), and
    `validateSystem` now checks the pinned versions against the declared ranges
    so a release can no longer satisfy the key set and violate the version set.
    Storage isolation — the other half of Bible §10 — is PACK-010-003.
  - Tests: `npx jest --ci module-runtime.test releases.test` -> 118/118,
    including "a dependency is a range on a capability, not a bare key" (16) and
    "a release is checked against the ranges its modules declare" (4).
  - Mutation: declared `reimbursements` -> `finance.ledger >=2.0.0` against a
    1.0.0 ledger -> 5 of 54 failed in `platform-config/src/modules.test` and 12
    of 15 in `lib/system/build-system.test`; loosened -> both green.
  - Mutation: removed the range check from `validateSystem` -> "refuses a pin
    below the range the depending module declares" failed; restored -> 60/60.
  - Mutation: made `>=` return true unconditionally in `satisfiesRange` ->
    "compares versions numerically, so 1.4.0 does not satisfy >=1.10.0" failed;
    restored -> 58/58.

- [ ] **PACK-010-003** — Prevent pack direct access to another pack's private storage or unauthorized tenant context.
  - Status: FAIL
  - **Measured, for the first time: 161 cross-domain storage reaches, in 59
    files, over 31 of the 38 governed models.** The requirement is not close to
    met, and until this run nobody could say by how much.
  - Code: `tools/pack-storage-reach.mjs` (new) — `reaches()`, and the CLI that
    prints them. It joins the two things that had to exist first and did, in
    different sessions: every module declares the Prisma models it governs
    (`objects` on `ModuleManifest`, held by
    `tests/architecture/module-objects.test.mjs`, PACK-040-002) which is what
    "another pack's storage" MEANS here, and every source file belongs to
    exactly one platform domain (`tools/ownership-map.mjs`, GE-020-001) which is
    what "which pack is reaching" means. Neither on its own can answer the
    question; the join can.
  - Caller: the command line, deliberately. It is an instrument, not a gate —
    see the next paragraph.
  - Evidence — run it: `node tools/pack-storage-reach.mjs` →
    `161 cross-domain storage reaches, in 59 files, over 31 of 38 governed
    models (12 modules).` Deterministic: `--json` twice into two files, `diff`
    them, identical. The worst sites are
    `apps/web/src/lib/platform/tenant-export.ts` (21 models, which is arguably
    correct — a tenant export is supposed to read everything, and it is the one
    finding a real gate would have to exempt by name),
    `apps/web/src/app/(app)/admin/actions.ts` (11) and
    `apps/web/src/app/(app)/orgs/[slug]/finance/actions.ts` (9). By owning
    module: `organizations` 50, `approvals` 30, `budgeting` 22,
    `administration` 21, `memory` 19, `events` 12, `messaging` 4, `feed` 2,
    `resources` 1.
  - Why no gate is committed, and why that is not evasion. A gate that fails
    breaks the build for eleven other domains; a gate that passes with 59 named
    exemptions is a list nobody reads and a rule that means nothing. The honest
    artifact at this stage is the number, in the ledger, with the instrument
    beside it — so whoever closes this requirement writes the gate against a
    measurement they did not choose, and the number they claim is the number
    this prints.
  - What the number is NOT: it is a floor. (a) Ownership is per DOMAIN and three
    modules share `erp-modules`, so a budgeting page reading a reimbursement row
    is invisible here. (b) It is lexical: `db.budgetLine.…` is seen, a helper
    taking a client and a delegate name from a variable is not, and raw SQL is
    not. Both limits are in the tool's docstring rather than in this ledger only.
  - The second half of the row — "or unauthorized tenant context" — is not
    measured at all and is not claimed. `withTenant` has two contradictory
    designs on record (`docs/architecture/REVIEW-FINDINGS.md`), and counting
    unscoped queries against a design nobody has settled would produce a number
    that changes meaning when they settle it.
  - Not BLOCKED_EXTERNAL: nothing external is missing. The work is a command or
    a repository port per module boundary, then a gate. It is large, not blocked.

- [ ] **PACK-010-004** — Prove no tenant/source fork or hard-coded tenant branch.
  - Status: FAIL
  - Three properties, stated separately because they fail differently. **Two
    hold and are now guarded; the third does not hold**, which is what decides
    this row.
  - Code: `tests/architecture/no-tenant-fork-or-branch.test.mjs` (new). Nothing
    in it is authored: the slugs come from `blueprints/index.ts`'s own `slug:`
    lines (the same array `RESERVED_TENANT_SLUGS` is built from) and the
    forbidden words come from that file's `platform.terminology.*` VALUES, so
    adding a tenant extends the check and renaming one cannot leave a stale rule.
  - Holds — **no branch.** No shipped file compares, switches on, keys off or
    tests membership of a tenant slug. Six decision shapes are searched across
    634 shipped files in `apps/web/src`, `apps/system-studio/src`, `packages`
    and `modules`; `blueprints/` is excluded because it DECLARES the bindings,
    and `tools/` because `tools/dev/show-config-history.mjs` defaults a CLI
    argument to `rochester` and ships to nobody.
  - Holds — **no fork in the tree.** No path in the repository is named for a
    tenant. This is the one that does not announce itself: a fork arrives as a
    directory with a customer's name, after which every file inside is
    individually defensible.
  - Does NOT hold — **a configured tenant word is still a literal in seven
    shipped files.** `rochester`'s binding sets
    `platform.terminology.staffOfficeName` to `"Ainslie OSE"`, and the comment
    beside it says that value "was a literal in eight components". Seven files
    still contain it: `apps/web/src/lib/policies.ts` (32 occurrences — the
    pilot's own policy documents transcribed into source, which needs a tenant
    content store rather than a config key), `apps/web/src/lib/resources.ts` (an
    audience label map), `apps/web/src/app/(app)/calendar/page.tsx` (the source
    label on every calendar row), `apps/web/src/app/error.tsx` and
    `apps/web/src/app/(app)/error.tsx` (both error boundaries' support
    sentence), `apps/web/src/app/(app)/admin/people/page.tsx` (an input
    placeholder) and `packages/platform-config/src/definitions.ts` (the
    configuration key's own description, naming the pilot's answer as the
    example). A platform holding a configuration key AND a literal for the same
    word is a platform where the second customer's answer is a code change,
    which is the pressure a fork comes from.
  - The guard is green with those seven NAMED, and the list can only shrink: a
    file on it that no longer holds the literal fails the test too, so fixing one
    forces the list and the count in this row to move together. It is not an
    exemption — each entry states the key that site should be resolving.
  - Tests: `node --test tests/architecture/no-tenant-fork-or-branch.test.mjs` →
    4/4 pass (692 files listed for the slug scan, 634 for the shipped scan).
  - Evidence — 4 mutations, 4 caught, all restored to 4/4:
    1. `apps/web/src/lib/clubs.ts` given
       `export const IS_PILOT = (slug: string) => slug === "rochester"` → "no
       shipped file branches on a tenant" FAILS naming the file, the slug and
       the regex that matched; "a tenant's slug is not a value in shipped
       source either" fails too. Restored → 4/4.
    2. `apps/web/src/lib/rochester/overrides.ts` created → "no path in the tree
       is named for a tenant" FAILS naming it. Directory removed → 4/4.
    3. `apps/web/src/lib/clubs.ts` given `export const OFFICE = "Ainslie OSE"` →
       the seventh-site check FAILS with "these files spell out a word a tenant
       configures, and are not on the list of known sites:
       apps/web/src/lib/clubs.ts". Restored → 4/4.
    4. The ratchet's own direction: `apps/web/src/lib/resources.ts` changed from
       `OSE: "Ainslie OSE"` to `OSE: "Staff office"` — a FIX — → the same test
       FAILS with "these files are listed as holding a configured tenant word
       and no longer do — remove them from HARD_CODED_TENANT_WORDS and update
       the PACK-010-004 count". That is the mutation that matters most here: it
       proves the list cannot quietly become an allowlist of things that are
       already fine. Restored → 4/4.
  - What would close it: resolve `platform.terminology.staffOfficeName` at the
    five label sites (the two error boundaries are client components, so this is
    real work rather than a find-and-replace), decide where the pilot's policy
    content belongs, and delete the seven entries. The guard then proves the
    whole requirement rather than two thirds of it.

- [ ] **PACK-020-001** — Implement scale, organization, operating, system-of-record, deployment, geography, functional, industry and provider axes.
  - Status: FAIL
  - Remaining: **three of the nine axes exist.** `organization`, `operatingModel`
    and `functional` are built, wired and mutation-proven below; `scale`,
    `system-of-record`, `deployment`, `geography`, `industry` and `provider` are
    not declared at all. Not PASS, deliberately — the item names nine and a
    ledger that reads PASS at three is how the other six stop being anybody's
    work. The next axis to build is `system-of-record`: PACK-020-004 landed
    `TenantBinding.coexistence.systemOfRecord` and a `system-of-record-external`
    refusal in `resolveModules`, so that axis now has a real consumer and can be
    lifted onto `ARCHETYPE_AXES` the way `operatingModel` was — a copy of a
    working pattern, roughly an hour. The other five still have nothing to be an
    input to (see the docstring at the top of `blueprints/archetype.ts`, which
    names what each would have to gate first) and must not be added as labels.
  - Code/config: `blueprints/archetype.ts` (new — `ARCHETYPE_AXES`,
    `ArchetypeSelection`, `compileArchetype`, `mergeArchetype`,
    `archetypeProblems`), `blueprints/types.ts` (`SystemBlueprint.axes`),
    the three blueprints under `blueprints/*/blueprint.ts`,
    `packages/module-runtime/src/manifest.ts`
    (`ModuleManifest.requiresOperatingModel`),
    `packages/module-runtime/src/resolve.ts`
    (`ResolveModulesInput.operatingModel`, `wrong-operating-model`),
    `packages/platform-config/src/modules.ts` (`modulesFor` passes the axis),
    `modules/index.ts` (budgeting declares the models it presumes).
  - Evidence for the three that are built: a blueprint carried none of the nine
    before this — a repo-wide grep for `archetype` returned prose in one document
    and nothing else. Each of the three is an input to RESOLUTION rather than a
    label, which is the bar this item sets:
    `organization` compiles `platform.terminology.organization{Singular,Plural}`
    into the `archetype` configuration layer (set by no blueprint and no tenant —
    see PACK-020-003); `operatingModel` gates modules through
    `requiresOperatingModel`; `functional` compiles the module set, replacing
    the exhaustive `SystemBlueprint.modules` list, which is now deleted.
    Tests: `packages/platform-config/src/modules.test.ts` — "a blueprint's axes
    compile to the system it runs" (5) and "the operating-model axis decides
    which modules a system may run" (5). 62/62 in
    `modules.test.ts` + `resolve.test.ts`; 1117/1117 across platform-config,
    provisioning, configuration, module-runtime, authorization and
    apps/web/src/lib/system.
  - Mutation: flipped `nonprofit-program-operations`' `operatingModel` axis from
    `federated` to `decentralized` → 2 failed ("refuses budgeting for a tenant
    without the finance entitlement" — the refusal reason becomes
    `wrong-operating-model`; "every blueprint's module selection actually
    resolves › midtown-arts"); restored → 45/45.
    Disabled the gate in `resolveModules` (`… && false`) → 4 failed; restored →
    45/45. Both proofs re-read the file after the run, because the tree is being
    edited concurrently and a mutation that was silently reverted proves nothing.

- [x] **PACK-020-002** — Implement presets as editable starting points, not locked tenant types.
  - Status: PASS
  - Code/config: `blueprints/types.ts` (`ModuleEdits`, `applyModuleEdits`,
    `moduleEditsBetween`, `TenantBinding.moduleEdits`), `blueprints/index.ts`
    (the `fixture-rtl` binding), `packages/platform-config/src/modules.ts`
    (`modulesFor` applies the edit before `resolveModules` and returns
    `provenance`), `apps/system-studio/src/app/tenants/new/ComposeForm.tsx`,
    `apps/system-studio/src/app/tenants/actions.ts`
  - What was wrong: a tenant ran exactly what its blueprint listed. The only
    per-tenant lever was an entitlement, which can subtract and never add, so
    "this customer wants announcements but not direct messages" had no
    expression at all and the answer would have been a fourth blueprint. The
    Studio half failed the other way: the module checkboxes had no
    `defaultChecked` and the blueprint `<select>` did not drive them, so the
    preset contributed nothing to a composition and nothing recorded that the
    operator had diverged from it.
  - Two grains, both real. The archetype axes (PACK-020-001) move a tenant to a
    different KIND of system; `moduleEdits` is a per-module delta over whatever
    those axes compiled to. `fixture-rtl` carries both, and `feed` — one module
    out of the `community` suite, without `messaging` — is a system only the
    second can express.
  - An edit cannot escape a rule. `add` enters the REQUESTED set, so entitlement,
    lifecycle, dependency and operating-model refusals all still apply; a
    `remove` leaves the set short, so a dependant is reported through the
    existing `missing-dependency` problem rather than being silently dropped.
  - Tests: 6 cases in `packages/platform-config/src/modules.test.ts`
    ("a tenant may edit its preset, and the edit is still subject to every
    rule"). Run: `cd apps/web && npx jest platform-config/src/modules.test -t "a tenant may edit its preset"`
    → 6 passed.
  - Evidence — 3 mutations, 3 caught:
    1. `fixture-rtl.moduleEdits` set to `{ add: [], remove: [] }` → "reports
       where each enabled module came from" FAILS, plus 2 blast-radius cases;
       restored → 6 passed.
    2. `rochester` given `moduleEdits: { add: [], remove: ["budgeting"] }` →
       `modulesFor("rochester").problems` names `reimbursements` and the pilot
       menu loses Reports (recorded under PACK-GATE-080 below, same run).
    3. `midtown-arts` given `add: ["budgeting"]` → still refused, with
       `missing-entitlement`, not granted.

- [x] **PACK-020-003** — Compile archetype selection into Configurator schemas/dependencies.
  - Status: PASS
  - Code/config: `blueprints/archetype.ts` (`compileArchetype`,
    `mergeArchetype`), `blueprints/index.ts` (`archetypeFor`,
    `compiledArchetypeFor`, and `fixture-rtl`'s one-axis override),
    `blueprints/types.ts` (`TenantBinding.archetype`),
    `packages/configuration/src/scopes.ts` (the `archetype` scope, between
    `blueprint` and `tenant`), `packages/platform-config/src/resolve.ts`
    (`layersFor` inserts the compiled layer),
    `packages/platform-config/src/definitions.ts` (the two compiled keys admit
    the new scope), `apps/system-studio/src/app/tenants/actions.ts` (the same
    layer in the console's execution context),
    `apps/system-studio/src/lib/adopt.ts` (an adoption records the composition).
  - Evidence: a tenant is no longer bound to one locked `blueprintId`. The
    blueprint supplies a DEFAULT selection; a binding may move one axis and
    inherits the rest (`mergeArchetype`, written axis by axis so a fourth axis is
    a compile error rather than one that silently never merges). `modulesFor`
    resolves `compileArchetype(mergeArchetype(blueprint.axes, binding.archetype))`
    — not `blueprint.modules`, which no longer exists — and `buildSystem` pins
    that result, so the release checksum follows the composition.
    Compiled into the configurator as a real layer, not a label: the
    `archetype` scope sits between `blueprint` and `tenant`, and
    `platform.terminology.organization{Singular,Plural}` are set by NO blueprint
    and NO tenant, so `terminologyFor("rochester").organization === "club"` is
    proof the layer applied. `modules.test.ts` enforces the corollary — no
    blueprint may set a key its own axes compile, because the archetype layer
    would silently win.
    Tests: `packages/platform-config/src/modules.test.ts` — "a binding moves one
    axis and inherits the rest" (3); `packages/platform-config/src/resolve.test.ts`
    — "layers blueprint below archetype below tenant", "resolves the
    organization's own word from the archetype layer and nowhere else";
    `apps/web/src/lib/system/reference-systems.test.ts` — "reference system C —
    one blueprint, one axis moved" (3), including the release checksum.
  - Mutation: (a) made `modulesFor` compile the blueprint's own selection instead
    of the binding's override — the locked-type implementation — → 2 failed
    ("resolves the override, not the blueprint's selection"; "reference system C
    › pins the axes' compiled module set"); restored → 61/61.
    (b) dropped the `archetype` layer from `layersFor` → 4 failed in
    `resolve.test.ts`, including both terminology assertions that had passed
    since the file was written; restored → 62/62.
    (c) dropped the `finance` suite from the nonprofit blueprint's `functional`
    axis → 6 failed; restored → 45/45.

- [x] **PACK-020-004** — Preserve Tenure-owned AWS-only runtime and model external on-prem systems through coexistence profiles.
  - Status: PASS
  - Code/config: `packages/module-runtime/src/coexistence.ts` (new — the seven
    bible-§2 profiles, the closed business-domain vocabulary and
    `coexistenceProblems`), `packages/module-runtime/src/resolve.ts`
    (the `system-of-record-external` ModuleProblem and the refusal inside
    `resolveModules`), `packages/provisioning/src/manifest.ts` (`coexistence`
    and `systemOfRecord` on `TenantManifest`, validated, plus a plan warning
    naming the external domains; `MANIFEST_VERSION` 1 to 2),
    `blueprints/types.ts` and `blueprints/index.ts`
    (`TenantBinding.coexistence`, and the `fixture-external-erp` binding),
    `packages/platform-config/src/modules.ts` (passes it into resolution).
  - Callers, named: `modulesFor` reaches `apps/web/src/app/(app)/layout.tsx:57`
    (`enabledModules`), `apps/web/src/app/api/me/route.ts:56` and
    `apps/system-studio/src/app/page.tsx`; the Studio composer
    (`apps/system-studio/src/app/tenants/new/ComposeForm.tsx` to
    `apps/system-studio/src/app/tenants/actions.ts` to `validateManifest` and
    `executionContext().resolveModules`); `apps/system-studio/src/lib/adopt.ts`.
  - Evidence: `npx jest --ci --testPathPattern "(provisioning|modules\.test)"`
    — 10 suites, 311 tests green; full `npx jest --ci` — 136/136 suites,
    3431/3431 tests green. 3 mutations, 3 caught:
    (1) `if (owned.length > 0)` to `if (false && owned.length > 0)` in
    `resolve.ts` — 2 tests red, restored green;
    (2) `systemOfRecord: binding.coexistence?.systemOfRecord` to `undefined`
    in `modules.ts` — 1 test red. This is the CALL-SITE mutation: it proves
    the wiring rather than the function. Restored green;
    (3) the profile check inside `coexistenceProblems` to `if (false)` —
    `provisioning.test.ts` "refuses a coexistence profile that is not one" red,
    restored green.
  - The fixture: `fixture-external-erp` runs the pilot's blueprint and holds the
    `finance` entitlement, and still does not run `budgeting` or
    `reimbursements` — both refused `system-of-record-external`, named per
    domain. `rochester` is the control and still runs both.

- [x] **PACK-030-001** — Implement canonical pack objects, versions, signatures, lifecycle and scope.
  - Status: PASS
  - Code/config: `packages/releases/src/release.ts` (`ReleaseSignature`, `signRelease`,
    `verifyRelease`, the approval gate in `transition`),
    `packages/platform-config/src/build-system.ts`,
    `apps/system-studio/src/app/tenants/[slug]/page.tsx`
  - Evidence: the artifact was content-hashed and never signed. A checksum proves
    the bytes are internally consistent; anyone able to alter the artifact can
    recompute one over their alteration, which is exactly the property adoption
    needs and does not get (bible §146, "Tenant pack adoption binds exact
    versions through a signed release manifest"). `signRelease` takes an
    HMAC-SHA256 over `contentBytes` — the *same* bytes the checksum covers, from
    one `contentOf`, so a signature can never attest to a different system than
    the checksum names. `transition(_, "approved")` now refuses an unsigned
    release, so the gate is in the state machine rather than in a caller that can
    forget it.
  - The second half of the item was that `buildSystem` had no production caller
    while its docstring named three. It now has one: the assembler moved to
    `@tenure/platform-config` — the package that exists because "both the tenant
    application and the System Studio need the same answer" — and the Studio's
    tenant page calls it. `apps/web/src/lib/system/build-system.ts` stays as the
    cell's import surface and its docstring now names its real callers.
  - Mutation: dropped `modules` from `contentOf` → "refuses a release whose
    content changed after signing" FAILED (`verdict.valid` true, expected false)
    plus the order-independence test; restored → 52/52 green.
  - Honest limit: HMAC, not a public-key signature — both ends are Tenure, so no
    third party verifies without the key. Recorded in the type's docstring
    against the day that changes.



- [ ] **PACK-030-002** — Implement capability modes and exact availability decisions.
  - Status: FAIL
  - Done, and proven: capability modes exist and are enforced.
    `packages/module-runtime/src/manifest.ts` declares `CAPABILITY_MODES`
    (TENURE_NATIVE / READ_ONLY / EXPORT_ONLY / UNAVAILABLE — four of Bible §11's
    nine, and only the four this platform can actually be in);
    `resolveModules` refuses `UNAVAILABLE` with `mode-unavailable` and returns a
    non-blocking `ModuleAdvisory` for READ_ONLY, EXPORT_ONLY, `deprecated` and
    `certified-limited`; `ModulePin` carries `lifecycle` and `mode` into the
    release checksum so an artifact can say what a module WAS when it was
    frozen; `/api/me` reports `moduleAdvisories` and `moduleProblems`.
    `search` ships READ_ONLY, which produces a standing advisory on every
    system that runs it.
  - Tests: `npx jest --ci module-runtime.test platform-config/src/modules.test`
    -> 112/112. Mutation: retired `memory` -> 5 of 54 failed in
    `platform-config/src/modules.test`; restored -> 54/54. Mutation: returned
    `advisories: []` from `modulesFor` -> "reports the limitations of the
    modules it is actually running" failed; restored -> 54/54.
  - Not done, which is why this is FAIL: the second half of the row — "exact
    availability decisions" — is Bible §5's `CapabilityAvailabilityDecision`
    over tenant / environment / **legal entity** / **population** / **country** /
    region / provider / mode / version. Tenant, operating model, system of
    record, mode, lifecycle, support window and engine version are all decided;
    legal entity, population and country are not modelled anywhere in this
    platform, so a decision cannot be scoped to them. That modelling belongs to
    PACK-020-001 (the archetype axes), which is itself FAIL. Buildable, not
    blocked — it is the next slice of this row, not a missing credential.

- [ ] **PACK-030-003** — Implement dependencies, alternatives, conflicts and compatibility evaluation.
  - Status: FAIL
  - Reclassified from PASS by the orchestrator, on its refuter's verdict. The
    alternatives half is real and independently re-proven. The compatibility half
    shipped a REGRESSION: all twelve manifests gained `requiresEngine`, and
    `resolve.ts` refuses a module whose caller cannot say which engine is
    running, but both `apps/system-studio/src/app/tenants/actions.ts` call sites
    passed neither `runningEngineVersion` nor `compareVersions` — while importing
    `ENGINE_VERSION` and `compareVersionStrings` and never using them. Probed
    against the real MODULE_CATALOG with the caller's exact argument shape:
    `KEYS: []`, five modules `engine-too-old`. Tenant composition and the
    provisioning execution context returned NO modules, not fewer.
    `git show HEAD:modules/index.ts | grep -c requiresEngine` is 0, so the change
    introduced it. `npm run studio:type-check` passed throughout — both arguments
    are optional in the type.
  - Fixed by the orchestrator: both call sites now pass the pair, and
    `tests/architecture/module-resolution-declares-its-engine.test.mjs` asserts
    every production caller does. Mutation: strip the pair from the composition
    call → 2 pass 1 fail; restored → 3 pass 0 fail. Left FAIL so the requirement
    is re-judged rather than self-certified.
  - Code: `packages/module-runtime/src/resolve.ts` (`ModuleCatalog.providersOf`,
    the `candidatesFor`/`wouldSatisfy` pair in `resolveModules`,
    `AmbiguousAlternativeError` in `expandDependencies`, `engine-too-old`),
    `packages/module-runtime/src/manifest.ts` (`provides`, `requiresEngine`),
    `packages/platform-config/src/compatibility.ts` (`compareVersionStrings`),
    `packages/platform-config/src/modules.ts` (the wiring),
    `apps/system-studio/src/app/tenants/actions.ts` (the Studio's two calls).
  - What changed: four things the row names, and two of them did not exist.
    Dependencies and conflicts were already reported and are now ENFORCED (see
    PACK-GATE-010). **Alternatives**: a dependency may name a capability, and
    any module declaring it in `provides` satisfies it — `reimbursements`
    depends on `finance.ledger`, which `budgeting` provides, so a second ledger
    would satisfy it without an edit. A refusal now lists every module that
    WOULD satisfy it, which is what makes an alternative actionable.
    `expandDependencies` throws rather than choosing between two providers.
    **Compatibility evaluation**: `requiresEngine` on the manifest, compared
    against the running `ENGINE_VERSION` at every `resolveModules` call behind
    `modulesFor`, so a cell too old to honour a module refuses it instead of
    half-applying it — the case `compatibility.ts`'s own doc comment describes.
  - Tests: `npx jest --ci module-runtime.test platform-config/src/modules.test`
    -> 112/112, including 16 in "a dependency is a range on a capability".
  - Mutation: deleted the `provides` branch from `candidatesFor` -> 3 failed in
    `module-runtime.test` and 5 in `platform-config/src/modules.test`; restored
    -> both green. Mutation: `>=` always true -> the 1.4.0/1.10.0 and
    engine-too-old assertions failed; restored -> 58/58.

- [x] **PACK-030-004** — Implement deprecation, suspension, end-of-support and retirement.
  - Status: PASS
  - Code: `packages/module-runtime/src/manifest.ts` (`supportEndsAt`,
    `ModuleSuspension`, `SUSPENSION_KINDS`, `certified-limited` and
    `ENABLEABLE`), `packages/module-runtime/src/resolve.ts` (`suspended`,
    `support-ended`, the deprecation advisory, the `at` input),
    `packages/platform-config/src/modules.ts` (`modulesFor(slug, at)`),
    `packages/releases/src/validate.ts` (a release may not pin a retired
    module).
  - What changed: deprecation was silently enableable and left no trace — a
    tenant on a deprecated module rendered identically to one on a supported
    one. It now produces a `ModuleAdvisory` carried through `SystemModules` to
    `/api/me`. Suspension did not exist: Bible §5's three orthogonal states
    (security / provider / regulatory) are now declarable and are checked FIRST,
    ahead of the entitlement, the same order `packages/provisioning/src/catalogs.ts`
    puts REVOKED in — telling a customer "you are not entitled" when the truth
    is "we withdrew it" is the wrong sentence in the one case that matters.
    End-of-support is a date compared against a supplied `at`, with an advisory
    before it and a `support-ended` refusal after. Retirement already refused at
    resolution and is now also refused in the release artifact, which outlives
    the resolution that produced it.
  - Tests: `npx jest --ci module-runtime.test releases.test` -> 118/118,
    including 6 in "a module can be withdrawn, suspended or unsupported".
  - Mutation: moved the entitlement check above the suspension check -> "reports
    the suspension ahead of the entitlement, because it is the true answer"
    failed; restored -> 58/58.
  - Mutation: stopped refusing a retired pin in `validateSystem` -> "refuses a
    release that pins a retired module" failed; restored -> 60/60.

- [x] **PACK-030-005** — Prove UI/API never labels unsupported scope available.
  - Status: PASS
  - Code: `tests/architecture/availability-labels-are-derived.test.mjs` (new) —
    four properties over the shipped surfaces of both apps and over every
    shipped module.
  - What was already true, and why it is not this requirement. The GATES exist
    and are tested: `isUsable` / `availabilityDecisions`
    (`packages/provisioning/src/catalogs.ts`) refuse an uncertified entry, a
    lapsed certification and an unreviewed region (47 tests, PACK-050-004 and
    PACK-080-003); `resolveModules` refuses `UNAVAILABLE` and removes an
    unresolvable module to a fixed point (PACK-GATE-010); `validateManifest`
    refuses `lifecycle: "available"` beside a declared gap (PACK-000-002). This
    row asks something else — whether a SURFACE can say available about
    something a gate would refuse — and every failure of that kind this
    repository has actually had was a literal at a call site, invisible to the
    gate and to every test that builds its own fixture: `certified: true` in JSX
    at four sites while the provider review was `NOT_SUBMITTED`
    (`tests/architecture/certified-is-derived.test.mjs`), and the Studio
    composer dropping `lifecycle` from `MODULE_CATALOG.all()`, which
    PACK-000-004's entry records as the one thing it left with no automated
    check. That check now exists.
  - The four properties: (1) a surface containing the label `Available` must
    reference a value some gate computed (`availabilityDecisions`, `.available`,
    `isUsable`, `certificationState`, `ENABLEABLE`, `lifecycle`) — one surface
    does, `apps/system-studio/src/app/page.tsx`, which draws "Available — n of
    m" from `capabilities.filter((d) => d.available)`; (2) no shipped file
    asserts `available: true` as a literal anywhere in `apps/*/src`, `packages`,
    `modules` or `blueprints` — `available: false` is deliberately allowed,
    because refusing is always safe; (3) no tenant surface under
    `apps/web/src/app/(app)` or `apps/web/src/components` imports
    `@tenure/modules`, so the tenant application renders the system it resolved
    rather than the catalog, and `/api/me` reports `moduleProblems` and
    `moduleAdvisories` beside the enabled set; (4) a surface that offers the
    whole catalog carries each module's `lifecycle:` into what it renders and
    takes `enableable` from `ENABLEABLE.has(...)`.
  - Caller: `tools/run-platform-tests.mjs` discovers every `tests/**/*.test.mjs`
    and CI runs it as `npm run test:platform`. Nothing had to be added to a
    shared script for this to run.
  - Tests: `node --test tests/architecture/availability-labels-are-derived.test.mjs`
    → 4/4 pass (over 100 surface files, over 400 shipped files, over 80 tenant
    UI files — each asserted as a floor, because every claim here is an absence
    and an absence over an empty scan is not a finding).
  - Evidence — 5 mutations, 5 caught, all restored to 4/4:
    1. `apps/web/src/app/(app)/calendar/page.tsx` given
       `export const PROBE_LABEL = "Available"` → property 1 FAILS: "these
       surfaces label something Available without deriving it from a gate:
       apps/web/src/app/(app)/calendar/page.tsx".
    2. `packages/provisioning/src/catalogs.ts` refusal changed from
       `available: false` to `available: true` → property 2 FAILS naming the
       file. This is the semantically apt mutation: a refusal relabelled.
    3. `apps/web/src/app/(app)/calendar/page.tsx` given
       `import { MODULE_CATALOG } from "@tenure/modules"` → property 3 FAILS:
       "these tenant surfaces import the module catalog directly".
    4. `apps/system-studio/src/app/tenants/new/page.tsx` — `lifecycle: m.lifecycle`
       deleted from the projection, which is PACK-000-004's actual defect →
       property 4 FAILS. **It did not, at first.** The check asked whether the
       file contained the word `lifecycle`, and it still did, twice:
       `enableable: ENABLEABLE.has(m.lifecycle)` and a comment. The guard
       certified the defect it was written for. It now requires the property
       assignment `lifecycle:`, and the same mutation reds. Recorded because the
       first version would have shipped as proof.
    5. Same file, `enableable: ENABLEABLE.has(m.lifecycle)` → `enableable: true`
       → property 4 FAILS on the second half. The check asks for
       `ENABLEABLE.has(` rather than `ENABLEABLE`, because the import survives
       the mutation and the symbol alone would have absorbed it.
  - Honest limit: this is lexical, and lexical checks are necessary rather than
    sufficient. It cannot prove the gate's own logic — that is the 47 catalog
    tests and the resolver's fixed point, cited above — and it cannot see a
    surface that renders a refusal's `reason` next to a green tick. What it
    removes is the class of failure that has actually occurred here twice: a
    literal beside a gate that was never consulted.

- [x] **PACK-040-001** — Create canonical registry entries for all functional capabilities in Section 8.
  - Status: PASS
  - Code: `tools/pack-capability-taxonomy.mjs` (new) — `registry()`,
    `capabilitiesOf`, `COVERED_BY`, and the two artifacts it renders:
    `docs/architecture/pack-capability-taxonomy.json` and
    `docs/architecture/pack-capability-taxonomy.md`. Guarded by
    `tests/architecture/pack-capability-taxonomy.test.mjs` (new).
  - **277 canonical entries across all ten §8 suites**, each with a stable id
    (`FUN-8.1-general-ledger`), the capability it names, the Bible bullet it was
    split from, a status and — where one exists — the module that covers it.
    §8's own first line is "Track every capability separately", and its bullets
    are comma lists of several: "Cash, treasury, banking, liquidity and
    reconciliation" is five capabilities, not one, so the split is mechanical and
    makes no attempt to be prettier than the source.
  - Parsed from the Bible, not written. A hand-written registry of 277
    capabilities is accurate the day it is typed and plausible from the next
    commit onward, which is the failure this programme keeps hitting. Every
    entry carries its own bullet and the guard searches the Bible for that
    bullet as TEXT, without the generator's parser.
  - The one authored thing is `COVERED_BY`: which of the twelve shipped modules,
    if any, covers a stated capability — judgement that cannot be computed,
    because no string in `modules/index.ts` says "this is §8.1's Budgeting". So
    it is declared with a reason, and everything about it is checked: the module
    key must exist in the catalog (the generator THROWS otherwise rather than
    emitting a document that hides it), the reason must be non-empty, and the
    entry's status is READ from that module's own `lifecycle` rather than written
    beside it. 15 of 277 are covered, by 9 of the 12 modules. `budgeting` covers
    §8.1's "Budgeting" and not its "General ledger", because it has no journals,
    no subledgers and no period close; `FUN-8.10-reporting` is mapped to nothing,
    because a landing surface and a `/reports` page are not the cross-module
    reporting §8.10 names beside lineage.
  - Caller: `tools/run-platform-tests.mjs` discovers the guard and CI runs it as
    `npm run test:platform`. The generator is not in the root `generate` script
    for the same reason `tools/pack-surface-inventory.mjs` is not — `package.json`
    is shared and was not this domain's to edit — so the freshness check names
    the command instead.
  - Tests: `node --test tests/architecture/pack-capability-taxonomy.test.mjs` →
    7/7 pass. `node tools/pack-capability-taxonomy.mjs --check` → current.
  - Evidence — 6 mutations, 6 caught, all restored to 7/7:
    1. One entry's quoted line corrupted in the committed JSON ("General ledger,
       …" → "Generalized ledger, …") → 2 red: the freshness check, and
       "FUN-8.1-general-ledger quotes a line …does not contain: Generalized
       ledger, subledgers, journals, allocations and period close."
    2. One entry deleted from the committed JSON (`FUN-8.7-capa`, counts
       adjusted to match) → 2 red, including "Bible §8 names "CAPA" in "Quality
       planning, inspection, nonconformance, CAPA and certificates." and no
       entry carries it". This is the omission direction, and it is caught by a
       second, dumber scan of the Bible written inside the test rather than by
       the generator's parser.
    3. `FUN-8.1-budgeting.coveredBy.module` changed to `procurement` → "is
       covered by "procurement", which the catalog does not declare".
    4. The GENERATOR changed to write `status: "available"` for a covered entry,
       then regenerated — so the freshness check passes and only the claim is
       wrong → "FUN-8.1-budgeting says "available" while budgeting declares
       lifecycle "certified-limited"". This is the inflation mutation, and it is
       the one that proves the status is derived rather than transcribed.
    5. One industry entry's status set to `certified-limited` → the §9 test reds
       (recorded under PACK-050-002).
    6. The generator's caveat capture disabled → the regulated-limits test reds
       (recorded under PACK-050-002).
  - What this row does NOT claim, stated because a 277-row document invites the
    opposite reading: 262 of the 277 are `not-implemented`, and the 15 that are
    not say `certified-limited`, never `available`. Breadth of REGISTRY is not
    breadth of product. Depth per plane is PACK-040-003, still FAIL.

- [x] **PACK-040-002** — Map each entry to owner, objects, states, controls, UI, integrations, tests and lifecycle.
  - Status: PASS
  - Code: `packages/module-runtime/src/manifest.ts` (`owner`, `objects`,
    `dimensions`), `modules/index.ts` (all twelve populated),
    `tests/architecture/module-objects.test.mjs` (new; the join nothing could
    make before).
  - What changed: all eight the row names now resolve for every entry. Five are
    structured fields a validator enforces — `owner` (a domain key from
    `tools/ownership-map.mjs`), `objects` (Prisma models), `permissions`
    (controls), `navigation` (UI) and `lifecycle`. The other three — states,
    integrations and tests — are the corresponding §6 dimension assessments,
    each carrying a file a reader can open. 30 of 41 Prisma models are now
    claimed by exactly one module; the 11 that are not are the platform's own
    tables, and the count is a ratchet that may only fall.
  - Tests: `node --test tests/architecture/module-objects.test.mjs` -> 7/7.
  - Mutation: `objects: ["Resource", "Ledger"]` (no such model) -> "every
    governed object is a model that exists" failed; restored -> 7/7.
  - Mutation: claimed `LedgerEntry` from `administration` as well as
    `budgeting` -> "no model is claimed by two modules" failed; restored -> 7/7.
  - Mutation: raised `UNCLAIMED` from 11 to 12 -> the ratchet failed in the
    "only fall" direction, which is the direction a ceiling would not catch;
    restored -> 7/7.
  - Mutation: cited `apps/web/src/lib/calendar-writer.ts` -> "every file a
    dimension cites is a file that exists" failed; restored -> 7/7.

- [ ] **PACK-040-003** — Implement initial complete vertical slices instead of shallow scaffolds across every suite.
  - Status: FAIL
  - Reason: imported from `Tenure_ERP_Archetype_and_Specialized_System_Pack_Factory_Claude_Bible_v1.0.md`; not yet implemented

- [x] **PACK-040-004** — Track all incomplete planes as planned/developing with explicit gaps.
  - Status: PASS
  - Code: `packages/module-runtime/src/manifest.ts` (`gaps`, the
    `certified-limited` lifecycle, and the rule that `available` and a declared
    gap are a contradiction), `modules/index.ts` (75 declared gaps across
    twelve modules), `packages/module-runtime/src/resolve.ts` (the
    `certified-limited` advisory), `packages/platform-config/src/modules.ts`
    (`SystemModules.advisories`), `apps/web/src/app/api/me/route.ts`.
  - What changed: every one of the twelve declared `lifecycle: "available"` and
    the manifest had no field in which a gap could be recorded, so an incomplete
    plane was not merely untracked — it was inexpressible. Each module now
    declares what it does not do, per dimension, in a sentence naming what is
    missing rather than what exists; `validateManifest` refuses `available`
    beside a gap and refuses `certified-limited` with none; and the gaps travel
    to whoever enables the module as an advisory on the running system.
  - Tests: `npx jest --ci platform-config/src/modules.test` -> 54/54, including
    "reports the limitations of the modules it is actually running", which
    asserts every enabled module carries a `certified-limited` advisory naming
    its gap dimensions.
  - Mutation: returned `advisories: []` from `modulesFor` -> that test failed;
    restored -> 54/54. Mutation: claimed `available` on `budgeting` with its
    accounting gap standing -> `ModuleCatalog.of` threw at import; restored.

- [ ] **PACK-050-001** — Implement industry pack internal structure and schema validation.
  - Status: FAIL
  - Reason: imported from `Tenure_ERP_Archetype_and_Specialized_System_Pack_Factory_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PACK-050-002** — Create registry taxonomy for Section 9 without claiming implementation.
  - Status: FAIL
  - Overturned on review: The substantive property holds, but one of the three enforcement mechanisms the claim and the ledger row state does not exist — verified by me directly, not by reading. Claim/ledger (a): 'COVERED_BY is keyed by functional id so an industry coverage claim throws as an unknown key — the generator throws.' It does not. registry()'s guard is Object.keys(COVERED_BY).filter(k => !usedIds.has(k)), and usedIds is filled by id('IND', ...) as well as id('FUN', ...) (tools/pack-capability-taxonomy.mjs lines 221-228 and 271), so a real industry id is a KNOWN key. Experiment: COVERED_BY['IND-9.1-discrete-manufacturing'] = {module:'budgeting', why:...} then registry() printed 'NO THROW — industry claim accepted'; the same experiment with COVERED_BY['FUN-8.1-not-a-capability'] printed 'THREW: COVERED_BY names 1 entry id(s) the Bible does not produce'. So an industry coverage claim is silently ignored rather than rejected — evidence in a PASS row that does not reproduce. Everything else I checked did reproduce: requirement sentence matches (Bible line 787); 57 industries across 9 families, counts.industryImplemented === 0, every industry status 'not-implemented' and coveredBy null; the preamble is verbatim 'Treat this as a maintained capability registry, not a claim that every pack is implemented.' and is text the Bible contains; caveats present on 9.1/9.5/9.6/9.7/9.8/9.9 and each verbatim. Mutations re-run individually, each restored to 7/7: IND-9.1-discrete-manufacturing status -> 'certified-limited' in the committed JSON -> 2 red including 'IND-9.1-discrete-manufacturing claims "certified-limited" and no industry pack exists'; the caveat capture disabled (else if (false)) and regenerated -> '§9.6 (Healthcare and life sciences) does not carry its own limit: expected a caveat containing "must not claim to replace an EHR"'; the §8 line corruption also reds the shared quote check. Remedy is one line — restrict the unknown-key filter to functional ids (e.g. keys not present among the FUN ids, or reject any key not starting 'FUN-') — or strike enforcement (a) from the ledger row. Until one of those, the row overstates its defences and I cannot pass it.
  - Code: `tools/pack-capability-taxonomy.mjs` (the `industry` half of
    `registry()`), `docs/architecture/pack-capability-taxonomy.json` and
    `.md`, `tests/architecture/pack-capability-taxonomy.test.mjs`.
  - **57 industries across all nine §9 families, 0 implemented.** Every family
    is parsed from the Bible, including §9.1's numbered list, and every entry
    carries the line it came from so the guard can search the Bible for it as
    text.
  - "Without claiming implementation" is enforced three ways rather than
    asserted once. (a) `COVERED_BY` is keyed by functional id only, so a
    coverage claim for an industry entry is rejected as an unknown key — the
    generator throws. (b) Every industry status is the constant
    `not-implemented`, written in the generator, so claiming otherwise requires
    editing code rather than a data file. (c) The guard checks the per-entry
    status AND `counts.industryImplemented === 0`, so an entry ADDED with a
    claim is caught even if the loop is satisfied.
  - The registry carries its own governing sentence, quoted rather than
    paraphrased: §9's own first line, "Treat this as a maintained capability
    registry, not a claim that every pack is implemented", is asserted verbatim
    and asserted to be text the Bible contains.
  - **The limits travel with the taxonomy.** A list of 57 industries with the
    caveats dropped is a claim that Tenure serves them, which is exactly what
    this requirement forbids — so every §9 prose paragraph is captured beside
    its family and every one is checked verbatim against the Bible. Three are
    named individually, by the phrase the Bible uses, so that losing one is a
    failure rather than a smaller number nobody reads: §9.6 "must not claim to
    replace an EHR", §9.8 "must not imply it is a core banking", §9.9 "remain
    governed external systems until specifically implemented and certified".
    §9.1, §9.5 and §9.7 carry theirs too.
  - Tests: `node --test tests/architecture/pack-capability-taxonomy.test.mjs` →
    7/7 pass, of which 2 are this row's ("the §9 taxonomy is every industry the
    Bible lists, claiming none of them", "the regulated families carry the
    Bible's own limits, verbatim").
  - Evidence — 3 mutations bearing on §9, 3 caught, all restored to 7/7:
    1. `IND-9.1-discrete-manufacturing` status set to `certified-limited` in the
       committed JSON → "IND-9.1-discrete-manufacturing claims
       "certified-limited" and no industry pack exists". The freshness check
       reds too, and the two are separate findings on purpose: a stale document
       and a false one are different problems.
    2. The generator's caveat capture disabled (`else if (false)`), then
       regenerated so freshness passes → "§9.6 (Healthcare and life sciences)
       does not carry its own limit: expected a caveat containing "must not
       claim to replace an EHR"".
    3. One entry's `line` corrupted (recorded under PACK-040-001, same
       mechanism, the §8 half).
  - Honest scope: this is the TAXONOMY, and nothing else. It does not deliver a
    pack (PACK-050-003, FAIL), does not define a pack's internal structure
    (PACK-050-001, FAIL), and its 57 zeroes are the state of the platform rather
    than a placeholder for work in progress.

- [ ] **PACK-050-003** — Deliver at least education/nonprofit, professional-services and discrete-manufacturing proving packs at declared scope.
  - Status: FAIL
  - Reason: imported from `Tenure_ERP_Archetype_and_Specialized_System_Pack_Factory_Claude_Bible_v1.0.md`; not yet implemented

- [x] **PACK-050-004** — Verify regulated-industry disclaimers and hard availability gates.
  - Status: PASS
  - Code/config: `packages/provisioning/src/catalogs.ts` — `CatalogRestrictions`
    (`region` and `disclaimer`) on `CatalogEntry`, the region refusal for
    connectors and extensions inside `isUsable`, `CapabilityAvailabilityDecision`
    and `availabilityDecisions` (bible §5), and `CATALOG_ENTRIES` — the
    catalog the gate had never had, holding `RELAY_ANTHROPIC_CONNECTOR`
    (egress `api.anthropic.com`, the one outbound integration with a call site,
    `apps/web/src/lib/ai.ts`) plus `MODEL_CATALOG`.
  - Caller, named: `apps/system-studio/src/app/page.tsx:67`. The operator
    surface renders an "Available" chip only for a decision that passed and
    lists every refusal with its reason and its disclaimer beside it.
  - Evidence: `npx jest --ci --testPathPattern catalogs` — 47 tests green.
    2 mutations here, 2 caught (2 more under PACK-080-003, same `isUsable`):
    (1) the region restriction to `if (false && ...)` — 2 tests red
    ("refuses a connector outside the regions it was reviewed for", "drops it
    out of availableToTenants for that region"), restored green;
    (2) `const disclaimer = entry.restrictions?.disclaimer` to `undefined`
    — 2 tests red, restored green.
  - Honest state recorded rather than papered over: the Relay connector carries
    NO certification, so the gate refuses it `uncertified` and the Studio shows
    it under "Not available, and why" with the egress disclaimer. Writing a
    `certifiedAt` would be a claim about a review nobody performed
    (PACK-000-004). The models still pass, so the gate is not refusing its whole
    catalog.

- [x] **PACK-060-001** — Implement process-chain contracts and cross-pack event composition.
  - Status: PASS
  - What was actually wrong: events existed and composition did not. `DomainEvent`
    was a real runtime gate and the transactional outbox was real, but nothing
    declared who emits or consumes what — `ModuleManifest` had no `emits`/
    `consumes`, no chain was declared anywhere, and a grep for `processChain`,
    `process-chain` or `procure-to-pay` across `apps/`, `packages/`, `modules/`
    and `blueprints/` returned zero hits. A system could enable `approvals`
    without `memory`, validate clean, and then accept requests whose outcome
    nothing preserves.
  - Shipped, and each piece is checked by something:
    - `ProcessChain` + `parseProcessChain` — the fifteenth kernel contract
      (`packages/contracts/src/index.ts`). It refuses a chain whose steps do not
      join (step n consuming what step n-1 never emits), a middle step that hands
      nothing on, a chain declared from its middle, and an event name
      `DomainEvent.type` would refuse. `isEventType` is extracted and shared, so
      a chain and the event that arrives cannot disagree about spelling.
    - `emits` / `consumes` on `ModuleManifest`
      (`packages/module-runtime/src/manifest.ts`), validated per manifest.
    - `ModuleCatalog.of` refuses a catalog where a declared consumer has no
      declared emitter, and refuses a chain whose step names a module that does
      not exist or claims an event that module's manifest never declares.
    - `PROCESS_CHAINS` in `modules/index.ts` declares
      `request-to-approval-to-memory`, and `MODULE_CATALOG.chains()` reaches
      `validateSystem` through `buildSystem`.
  - The emitter is real, not aspirational. `apps/web/src/app/(app)/approvals/actions.ts`
    now writes `ApprovalRequested` and `ApprovalDecided` to `OutboxEvent`
    **inside the same `$transaction`** as the status change that causes them,
    through `outboxEventRow` (`apps/web/src/lib/outbox/outbox.ts`), which runs
    `parseDomainEvent`. Before this the outbox had no production producer at all.
  - Stated plainly, because the requirement's title says "composition": the
    declaration is enforced at catalog construction and at release validation. It
    is not yet *delivered* — `dispatchOnce` takes a `deliver` port and no runner
    supplies one, so nothing consumes `ApprovalDecided` at runtime. That runner
    is the next piece and will be held to this declaration rather than inventing
    its own list. `modules/index.ts` says so where `memory.consumes` is declared.
  - Code: `packages/contracts/src/index.ts`,
    `packages/module-runtime/src/manifest.ts`,
    `packages/module-runtime/src/resolve.ts`, `modules/index.ts`,
    `packages/releases/src/validate.ts`, `apps/web/src/lib/outbox/outbox.ts`,
    `apps/web/src/app/(app)/approvals/actions.ts`
  - Tests: `packages/module-runtime/src/module-tools-and-chains.test.ts` (13),
    `packages/contracts/src/contracts.test.ts` (6 ProcessChain cases),
    `apps/web/src/lib/outbox/outbox.test.ts` (3 for `outboxEventRow`),
    `apps/web/src/lib/system/build-system.test.ts` (chain coherence)
  - Mutations, 4 applied, 4 caught, all restored:
    1. Removed the `knowledge` suite (the `memory` module) from
       `blueprints/university-student-organizations/blueprint.ts` → `buildSystem`
       refused with `The "Request → approval → memory" chain
       (request-to-approval-to-memory) starts in module "approvals" but cannot
       finish: step 3 handles "ApprovalDecided" and needs module "memory"`,
       taking 12 of 15 build-system tests red. Restored → 15/15.
    2. Disabled the consumer-without-emitter check in `ModuleCatalog.of` →
       `refuses a consumer with no emitter anywhere in the catalog` red.
       Restored → 13/13.
    3. Replaced the chain loop's source with `[]` in `validateSystem` →
       `refuses the same system with a chain's later step removed, naming the
       step` red. Restored → 67/67.
    4. `outboxEventRow` skips `parseDomainEvent` → `refuses an event the contract
       refuses, before it can become a row` red. Restored → 16/16.
  - Evidence: `npm run type-check` 0 errors;
    `npm run test --workspace apps/web -- --ci` 3448/3448 across 137 suites.

- [ ] **PACK-060-002** — Route all financial effects through universal accounting events and validated journals.
  - Status: FAIL
  - Reason: imported from `Tenure_ERP_Archetype_and_Specialized_System_Pack_Factory_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PACK-060-003** — Implement exceptions, compensation, reconciliation and drill-through.
  - Status: FAIL
  - Reason: imported from `Tenure_ERP_Archetype_and_Specialized_System_Pack_Factory_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PACK-060-004** — Pass E2E chain tests across module boundaries and failures.
  - Status: FAIL
  - Reason: imported from `Tenure_ERP_Archetype_and_Specialized_System_Pack_Factory_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PACK-070-001** — Implement declarative TES UI contributions and forbid unreviewed pack shells.
  - Status: FAIL
  - Reason: **1 of the 8 declaration categories in bible §15:568-577 exists.**
    `ModuleNavEntry` now carries "command actions and confirmation/risk class";
    page schema and data query contracts, saved view/report definitions,
    drill-through and provenance, memory and Relay context, and performance and
    accessibility budgets do not. Declaring them ahead of the engines that would
    read them is what this item is *for*, so they are left undeclared rather than
    written and unchecked — which means the item stays FAIL and stays queued.
  - What was built and is proven, so the next tick does not redo it:
    - `tests/architecture/nav-hrefs-are-served.test.mjs` — the falsification the
      contract never had. `packages/platform-config/src/modules.test.ts:112-131`
      claimed to check every nav href against the routes the app serves and
      compared them against a hand-written `const served = new Set([...])` in the
      test itself. Deleting `apps/web/src/app/(app)/calendar/page.tsx` left it
      green. The check now derives the served routes from `collect().pages` in
      `tools/entry-point-inventory.mjs` and names nothing.
    - `tools/entry-point-inventory.mjs` — `listFiles` now drops paths git's index
      still lists but the worktree does not have. Without it a deleted page was
      still reported as served (and the read threw ENOENT), so the check above
      could not see a deletion at all.
    - `packages/module-runtime/src/manifest.ts` — `ModuleNavEntry.riskClass`
      (`read | write | irreversible`), REQUIRED beside `action` and refused
      without it. Read by `validateManifest` (runs at catalog construction, i.e.
      at import of `modules/index.ts` in production) and by
      `moduleAdoption().commands`, which the Studio's Platform page renders
      beside each module's blast radius.
    - Two untrue comments corrected: `modules/index.ts:9-11` and
      `packages/platform-config/src/modules.test.ts:113`.
  - Tests: `node --test tests/architecture/nav-hrefs-are-served.test.mjs` → 3
    passed; `cd apps/web && npx jest platform-config/src/modules.test -t "blast radius"`
    → 5 passed (includes "carries the risk class of every command surface").
  - Evidence — 3 mutations, 3 caught:
    1. `apps/web/src/app/(app)/calendar/page.tsx` renamed → the href test FAILS
       naming `events.calendar -> /calendar`; restored → 3 passed.
    2. `riskClass: "read"` deleted from the `search` manifest → the architecture
       test FAILS naming `search.assistant (openAiPanel) -> none`; and
       `ModuleCatalog.of` on a fixture carrying the same entry throws
       `Module "search" nav entry "search.assistant" fires the command
       "openAiPanel" without declaring a riskClass`. With `riskClass: "read"`
       present, no riskClass complaint is raised. Restored → green.
    3. See PACK-000-004 for the `/reports` deletion, which the same test catches.

- [ ] **PACK-070-002** — Implement canonical data extensions and migration contracts.
  - Status: FAIL
  - Reason: imported from `Tenure_ERP_Archetype_and_Specialized_System_Pack_Factory_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PACK-070-003** — Resolve integration requirements only through the certified integration runtime.
  - Status: FAIL
  - Reason: imported from `Tenure_ERP_Archetype_and_Specialized_System_Pack_Factory_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PACK-070-004** — Implement pack-specific memory, Relay policies, typed tools and evaluations.
  - Status: FAIL
  - Typed tools are DONE and are the reason this entry is no longer a stub. What
    is still missing is named below, and it is why the status is FAIL rather than
    PASS: pack-scoped memory and Relay **evaluations** are not built, and calling
    the whole requirement done on the strength of the tools half would be exactly
    the false PASS this ledger exists to prevent.
  - Done — typed tools, declared by a pack and authorized per call:
    - `ToolRegistration` had zero production producers and zero consumers; the
      only AI surface registered no tools at all and retrieved unconditionally.
    - `ModuleManifest.tools` (`packages/module-runtime/src/manifest.ts`) now
      carries registrations, and `validateManifest` runs `parseToolRegistration`
      on each, refuses a tool whose `module` is not the manifest's own key,
      refuses a duplicate tool key, and refuses a `requiredPermission` that is
      not in the permission catalog or is gated on another module — reusing the
      `lookupPermission` check already there for permissions.
    - `modules/index.ts` declares one real tool: `search.corpus` on the `search`
      module, `readOnly: true`, `reauthorizesPerCall: true`, gated on
      `search.index.query`.
    - `apps/web/src/lib/relay-tools.ts` resolves the tool set from
      `modulesFor(slug).enabled` and puts every registration through `decide()`,
      via the kernel's `PermissionCheck`/`PermissionDecision`.
    - `apps/web/src/app/api/ai/chat/route.ts` retrieves **nothing** until
      `search.corpus` survives that check, and reports a refusal separately from
      the `aiAssistant` flag — "this tenant switched the vendor off" and "you may
      not search here" are different things to tell someone.
  - Behaviour that changed: a tenant whose blueprint does not select `search`
    (`midtown-arts`) now has no retrieval capability rather than one that
    silently returns nothing; a principal without `search.index.query` gets a
    stated refusal rather than an empty result set; and because the seats are
    re-read per request, a seat that ends between two questions stops answering
    on the second.
  - Still open, and what each needs:
    - **Pack-scoped memory.** `apps/web/src/lib/memory.ts` scopes visibility on
      club seats, not on a pack. Needs a memory scope on the manifest and a
      reader that honours it.
    - **Relay evaluations.** `packages/platform-config/src/model-policy.ts` is
      still only the allowed-model catalog and is honest about it. Evaluation
      results, prompt/tool versions and AI cost controls have nothing behind
      them; building an evaluation harness is the work, not a field.
    - **Per-pack Relay policy.** `MODEL_CATALOG` is platform-wide. Making it
      per-pack needs a policy layer the engine distributes to a cell, which is
      the same distribution path localization and flags already use.
  - Code: `packages/module-runtime/src/manifest.ts`, `modules/index.ts`,
    `apps/web/src/lib/relay-tools.ts`,
    `apps/web/src/app/api/ai/chat/route.ts`,
    `packages/contracts/src/index.ts` (permission-key rule)
  - Tests: `packages/module-runtime/src/module-tools-and-chains.test.ts` (13),
    `apps/web/src/lib/relay-tools.test.ts` (8),
    `apps/web/src/app/api/ai/ai-kill-switch.test.ts` (3 added for the tool gate)
  - Mutations, 2 applied, 2 caught, both restored:
    1. `modules/index.ts` declares `search.corpus` with `readOnly: false,
       reauthorizesPerCall: false` → catalog construction throws
       `ModuleManifestError: Module "search" declares tool "search.corpus", which
       does not satisfy the ToolRegistration contract:
       ToolRegistration.reauthorizesPerCall: a tool that writes must reauthorize
       per call`, taking both suites to 0 tests. Restored → 21/21.
    2. The chat route ignores the tool decision (`const mayRetrieve = true`) →
       `retrieves nothing, and says why, when it is not` red. Restored → 14/14.
  - Evidence: `npm run type-check` 0 errors;
    `npm run test --workspace apps/web -- --ci` 3448/3448 across 137 suites.

- [ ] **PACK-070-005** — Pass accessibility, performance, security, isolation and long-session UX gates.
  - Status: FAIL
  - Reason: imported from `Tenure_ERP_Archetype_and_Specialized_System_Pack_Factory_Claude_Bible_v1.0.md`; not yet implemented

- [x] **PACK-080-001** — Bind code/config/schema/migrations/process/UI/report/Relay/connector/tests/support into one pack release.
  - Status: PASS
  - Code/config: `packages/releases/src/release.ts` (`schemaVersion` on
    `ReleaseInput`/`SystemRelease`/`ReleaseContent`, `contentOf`, `createRelease`,
    `diffReleases`, `breakingChanges`, `rollbackTo`),
    `packages/releases/src/validate.ts` (`appliedMigrations`),
    `packages/platform-config/src/build-system.ts`
  - Evidence: one field that is verifiable end to end rather than eleven that are
    not. The release bound five of the eleven things named; the platform ALREADY
    computed the missing schema pin and threw it away —
    `apps/system-studio/src/app/tenants/actions.ts:139` defines
    `schemaVersion: () => process.env.SCHEMA_VERSION ?? "unpinned"` and that value
    never reached `createRelease`. It now does, through `buildSystem`, which reads
    the same variable and lets a caller that knows better (the Studio, which knows
    the schema the target CELL is at) pass it explicitly.
  - `schemaVersion` is INSIDE `contentOf`, so it is bound rather than attached:
    two systems identical in every other respect but running against different
    migration states no longer hash alike. `diffReleases` shows the move to the
    approver it exists to inform, and `breakingChanges` flags it when it goes
    backwards — compared lexicographically, because Prisma migration directories
    are timestamp-prefixed and the semver comparator would throw on one.
  - Mutation 1: deleted `schemaVersion` from `contentOf` → "binds the schema
    INSIDE the checksum, not beside it" FAILED; restored. Mutation 2 (wiring):
    `buildSystem` with `appliedMigrations: ["20260730000000_baseline"]` and a
    candidate pinning `20260806180000_activation_gates_serving` is `valid: false`
    naming the migration, and `candidate` is null. `rollbackTo` still satisfies
    its own byte-identity assertion with the new field present — covered by
    "still restores byte-identical content through a rollback".
  - Honest limit: connector, report, Relay and support scope are still not on the
    artifact. Adding them as fields nothing produces or checks would be
    declarations that cannot be wrong, which is the failure mode this ledger
    exists to stop. They remain open under their own items.



- [ ] **PACK-080-002** — Implement tenant adoption, compatibility, wave, canary, hold, rollback and forward recovery.
  - Status: FAIL
  - Code/config: `packages/releases/src/release.ts` (`scheduled` and `canary` in
    `ReleaseState` and `TRANSITIONS`), `packages/platform-config/src/build-system.ts`
    (`ROLLOUT_PATH`, `planPromotion`),
    `apps/system-studio/src/app/tenants/[slug]/page.tsx` (the Release section)
  - What is now real: `active` is reachable ONLY through `canary`, and `canary`
    only through `scheduled` — held by a test that reads `TRANSITIONS` and asserts
    the set of states from which `active` is reachable is exactly `["canary"]`.
    Approval used to mean the whole fleet took the change at once, so the first
    evidence a release was bad was everyone having it. `planPromotion` walks the
    real state machine rather than restating its rules, so the gates shown are the
    gates that would refuse; it is the first non-test caller of `transition`,
    `diffReleases` and `breakingChanges`, and the Studio's tenant page is its
    production caller. `checkCompatibility` is reached through `compatibilityFor`
    and blocks the promotion at `approved`.
  - Mutation 1: `TRANSITIONS.scheduled: ["canary"] → ["active"]` → the suite
    failed to run with `ReleaseError: Cannot move release rochester@r1 from
    "scheduled" to "canary"`; restored. Mutation 2: an incompatible verdict with
    an `unknown-key` problem → `planPromotion` stops at `validated`, `blocked`
    names the key, and the `approved` step reports `reached: false`.
  - Why this stays FAIL and not PASS: the item names seven things and three are
    absent. There are no rollout **waves** (no cohort of tenants to schedule),
    no **hold** state, and no **forward recovery** path — and `planPromotion`
    persists nothing, because there is no store for release artifacts, so the
    Studio can say what WOULD happen and cannot make it happen. Marking this PASS
    on the canary and compatibility halves would be exactly the false claim the
    `buildSystem` docstring was. The remaining work is buildable here — a release
    store in the tenant registry and the three missing states — so this is FAIL,
    not BLOCKED_EXTERNAL.



- [x] **PACK-080-003** — Implement certification scope/evidence/expiry and re-certification triggers.
  - Status: PASS
  - Code/config: `packages/provisioning/src/catalogs.ts` — `CatalogCertification`
    (`scope`, `evidenceRefs`, `certifiedAt`, `expiresAt`) on `CatalogEntry`,
    `certificationState` and `RECERTIFICATION_WARNING_DAYS` (the
    re-certification trigger), and the `uncertified` and
    `certification-expired` branches of `isUsable`. `now` is a parameter and
    never a clock read, so a decision is replayable.
  - Caller, named: `apps/system-studio/src/app/page.tsx:67` through
    `availabilityDecisions`, which renders "re-certification due" for an entry
    inside the warning window and refuses a lapsed one outright.
  - Evidence: `npx jest --ci --testPathPattern catalogs` — 47 tests green.
    2 mutations, 2 caught:
    (1) `if (at >= expires) return "expired"` to `if (false)` — 4 tests red
    ("refuses one whose certification has lapsed", "expires at the instant, not
    the day after", "decides from the `now` it is given rather than from a
    clock", "keeps a lapsed entry out of what a tenant is offered"), restored
    green;
    (2) the `certification === "absent"` branch to `if (false)` — 3 tests
    red, two of them over the real `CATALOG_ENTRIES`, restored green.
  - Fails closed twice over: a record with no scope or no evidence is `absent`
    rather than `current`, so both required fields are load-bearing; and an
    unparseable `expiresAt` is `expired` rather than valid.

- [ ] **PACK-080-004** — Make global updates reach Simon and all compatible tenants without overwriting explicit configuration.
  - Status: FAIL
  - Reason: imported from `Tenure_ERP_Archetype_and_Specialized_System_Pack_Factory_Claude_Bible_v1.0.md`; not yet implemented

- [x] **PACK-080-005** — Block vulnerable unsupported pins and unsafe downgrades.
  - Status: PASS
  - Code/config: `packages/releases/src/validate.ts` (`previousModules`,
    `catalogVersions`, injected `compare`), `packages/releases/src/release.ts`
    (`breakingChanges` takes a comparator), `packages/platform-config/src/build-system.ts`
    (`systemUnderValidation`)
  - Evidence: nothing anywhere compared two module versions. `createRelease` took
    `previous` purely for revision numbering, `diffReleases` emitted
    `modules.<key> changed` without ordering the two sides, and `breakingChanges`
    filtered only removals and a topology change — so `2.0.0 → 1.0.0` read as an
    ordinary "changed" line an approver scrolls past, while it takes away
    everything 2.0.0 added and leaves data written by the newer code behind. Both
    functions were also dead: no caller outside the package's own re-export.
  - The comparator is reused, not rewritten: `compareVersions`/`parseVersion` in
    `packages/platform-config/src/compatibility.ts`, whose own doc comment says it
    is owned there so there is one copy. `@tenure/releases` imports nothing, so it
    is injected — and a `previousModules` supplied WITHOUT a comparator produces a
    problem of its own rather than silently skipping the check. `rollbackTo` is
    exempt by construction (it builds from a target release, never through
    `validateSystem`) and says so in a comment.
  - Mutation: `if (order > 0)` → `if (false)` in `validate.ts` → "refuses a pin
    below the active release's, and says what to do instead" FAILED; restored →
    52/52 green. The assertion that proves the ordering is NUMERIC rather than
    merely present: `1.9.0 → 1.10.0` is ACCEPTED, in both the package test and
    the `buildSystem` test that runs the real injected comparator — a string
    compare would refuse a legitimate tenth minor and nobody would notice until
    then.
  - Unsupported pins: `catalogVersions` is built from `MODULE_CATALOG` at the
    real caller, so a release pinning a version the catalog no longer ships, or a
    module it has dropped entirely, is refused with the version it does ship.



- [ ] **PACK-090-001** — Prove all ten required E2E scenarios.
  - Status: FAIL
  - Reason: imported from `Tenure_ERP_Archetype_and_Specialized_System_Pack_Factory_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PACK-090-002** — Prove materially different data, authority, workflow, accounting, integration and AWS outcomes from one engine.
  - Status: FAIL
  - Reason: imported from `Tenure_ERP_Archetype_and_Specialized_System_Pack_Factory_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PACK-090-003** — Prove coexistence with an external/on-prem ERP without deploying Tenure outside Tenure AWS.
  - Status: FAIL
  - Reason: imported from `Tenure_ERP_Archetype_and_Specialized_System_Pack_Factory_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PACK-090-004** — Produce final supported-scope matrix with every limitation and blocked external dependency.
  - Status: FAIL
  - Reason: imported from `Tenure_ERP_Archetype_and_Specialized_System_Pack_Factory_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PACK-GATE-000** — Catalog truth matches implemented/certified scope.
  - Status: FAIL
  - Children: 4 of 4 decided — `PACK-000-001` PASS, `PACK-000-002` PASS,
    `PACK-000-003` PASS, `PACK-000-004` PASS. The inventory
    (`docs/architecture/pack-surface-inventory.md`, generated) and the
    requirement import (`tests/architecture/pack-requirements-imported.test.mjs`)
    are the two that were outstanding; both closed with mutation proof.
  - The gate itself stays FAIL. All four children being decided is a necessary
    condition and not the gate's own claim: "catalog truth matches
    implemented/certified scope" is a statement about the SCOPE the catalog
    advertises, and nothing yet compares the twelve manifests' declared scope
    against what a tenant is actually offered end to end. Ticking a gate the
    moment its children go green is how a gate becomes a sum instead of a check.
  - **PASS withdrawn.** A gate is proven by its children and by nothing else,
    and this one was ticked over an inventory that has not been taken and a
    requirement import that has not happened — the two children that decide
    whether "catalog truth" has anything to be true about. It survived because
    `tests/architecture/pass-requires-evidence.test.mjs` only compared a gate to
    its children when the gate stated a child ratio, and this entry stated none:
    the one edit that makes a false PASS unfalsifiable also switched off the
    check for it. That test now derives the children from the ids whether or not
    a ratio is written, and refuses a PASS gate that writes no ratio at all.
  - The work recorded below is real and is not withdrawn with the status — it is
    the evidence for the catalog-governance code, which is a part of this gate
    and not the whole of it.
  - Code/config: `packages/module-runtime/src/resolve.ts` — `CatalogGovernance`
    and the reconciliation inside `ModuleCatalog.of`: every manifest key must be
    in `MODULE_KEYS` and every `MODULE_KEYS` entry must have a manifest, in both
    directions. Plus `tierDeclarationProblems`, the boot-time assertion
    REVIEW-FINDINGS #5 asks for. `MODULE_CATALOG` is built at import
    (`modules/index.ts`), so both fire on every boot of `apps/web` and the
    Studio rather than only in a scheduled test.
  - Callers, named: `modules/index.ts` builds `MODULE_CATALOG`, imported by
    `packages/platform-config/src/modules.ts:32` and reached from
    `apps/web/src/app/(app)/layout.tsx:57` and
    `apps/system-studio/src/app/page.tsx`.
  - Evidence: `npx jest --ci --testPathPattern module-permissions` — 19 tests
    green; full `npx jest --ci` — 136/136 suites, 3431/3431 tests green.
    3 mutations, 3 caught:
    (1) `if (!governed.has(key))` to `if (false)` — "refuses a manifest whose
    key is not in MODULE_KEYS" red (the fixture is a manifest keyed
    `procurement`), restored green;
    (2) `if (!byKey.has(key))` to `if (false)` — "refuses a MODULE_KEYS entry
    with no manifest" red, restored green;
    (3) `if (!declared.includes(role.minTier))` to `if (false && ...)` —
    2 tests red including "fires from catalog construction, not only from this
    test", which gives a role `minTier: "platinum"` with no such tier. Restored
    green.
  - The tier assertion caught a real defect the moment it was switched on:
    `finance.approver` (`minTier: "ledger"`) spans `budgeting`, `reimbursements`
    and `approvals`, and only `budgeting` declares tiers. `decide.ts:383` ranks
    a tier against THE REQUESTED PERMISSION's module, so the rule is stated at
    that grain: a pack that declares tiers must declare this one, and a role no
    pack it touches could ever rank is refused as inert. The `"platinum"` case
    REVIEW-FINDINGS names is still refused.

- [ ] **PACK-GATE-010** — Packs extend one secure kernel.
  - Status: FAIL
  - Children: 1 of 4 decided. PACK-010-002 (guarded extension points and
    dependency rules) is PASS; PACK-010-001 (one platform kernel),
    PACK-010-003 (no pack reaching another pack's private storage) and
    PACK-010-004 (no tenant fork or hard-coded tenant branch) are FAIL.
    Corrected from "2 of 4", which counted PACK-010-001 as PASS while the
    ledger has it FAIL — written in the keyed form because
    `tests/architecture/pass-requires-evidence.test.mjs` could not read the
    prose one, so the number went stale with nothing watching.
  - Closed in this pass, and the reason the gate moved at all: dependency and
    conflict rules were REPORTED and not ENFORCED.
    `packages/module-runtime/src/resolve.ts` pushed a `missing-dependency` or
    `incompatible` problem and then emitted the offender into `ordered`/`keys`
    anyway — and the production consumers take `.keys` and discard
    `.problems` (`apps/web/src/app/(app)/layout.tsx`,
    `apps/web/src/app/api/me/route.ts`), so an unresolvable module was enabled
    in production, widened the capability set through the authorization module
    gate (`packages/authorization/src/decide.ts`) and rendered its navigation.
    The docstring said "fail closed throughout" while it did the opposite.
    `resolveModules` now removes offenders to a FIXED POINT — one pass is not
    enough, because dropping a module breaks whatever depended on it — and both
    members of an incompatible pair go, rather than the resolver choosing which
    module the operator meant.
  - Tests: `npx jest --ci module-runtime.test platform-config/src/modules.test`
    -> 112/112. The assertions are on `keys`, deliberately: the old tests
    asserted only the problem list, which is why they passed throughout.
  - Mutation: reverted the fixed-point removal to report-only -> 4 failed in
    `module-runtime.test` and 3 in `platform-config/src/modules.test`, including
    "removes the second-order dependant too, which one pass would not";
    restored -> 112/112.
  - What the gate still needs: PACK-010-003 now has its substrate — every module
    declares the Prisma models it governs (`objects`, enforced by
    `tests/architecture/module-objects.test.mjs`), which is the definition of
    "another pack's private storage" that did not exist before.

- [ ] **PACK-GATE-020** — Tenant systems are multi-axis compositions.
  - Status: FAIL
  - Children: 3 of 4 decided. PACK-020-002, PACK-020-003 and PACK-020-004 are
    PASS; PACK-020-001 — "implement scale, organization, operating,
    system-of-record, deployment, geography, functional, industry and provider
    axes", the axes this gate is named for — is FAIL, and its own entry says so
    ("The next axis to build is `system-of-record`").
  - **PASS withdrawn**, same mechanism as PACK-GATE-000: no stated ratio, so
    `tests/architecture/pass-requires-evidence.test.mjs` never compared it to
    its children. A gate called "multi-axis compositions" cannot be PASS while
    the requirement that implements the axes is FAIL — the composer offers the
    axes that exist, which is the achievement recorded below, not all nine.
  - Code/config: `packages/module-runtime/src/manifest.ts`
    (`requiresOperatingModel`), `packages/module-runtime/src/resolve.ts`
    (`operatingModel` input, `wrong-operating-model` problem reason),
    `packages/platform-config/src/modules.ts`,
    `packages/provisioning/src/manifest.ts`
    (`TenantManifest.archetype` + validation against a supplied axis table),
    `apps/system-studio/src/app/tenants/new/ComposeForm.tsx` and
    `.../new/page.tsx` (the axes are selected in the composer),
    `apps/system-studio/src/app/tenants/actions.ts` (validated the same way
    `blueprintId` is, and the plan is checked against what the composition
    requires), `apps/system-studio/src/app/page.tsx` and
    `apps/system-studio/src/lib/adopt.ts` (both now fold through `modulesFor`
    rather than resolving the blueprint's raw list, which ignored the axes).
  - Evidence: a tenant system was composed from exactly two things — a blueprint
    id and a flat entitlement list, which is boolean membership of a set and
    cannot express an operating model at all. It is now composed from three axes
    plus entitlements, and the operating-model axis is enforced in resolution
    with its own problem reason, checked BEFORE the entitlement because "this
    system is not shaped for that module" is the true answer when both apply —
    selling the entitlement would not make it work.
    The composer offers the axes from `ARCHETYPE_AXES` (never a hard-coded list),
    `composeTenant` puts them on the manifest, and `validateManifest` refuses an
    axis value the engine does not implement — and refuses outright when no axis
    table was supplied, rather than accepting a composition nothing verified.
    Tests: `packages/platform-config/src/modules.test.ts` — "takes Reports out of
    the menu, with that reason" (through `navigationFor`, the function
    `apps/web/src/app/(app)/layout.tsx` builds its menu with), "refuses before the
    entitlement", "refuses when no operating model was supplied at all";
    `packages/provisioning/src/provisioning.test.ts` — "the archetype selection"
    (6).
  - Mutation: disabled the operating-model gate in `resolveModules` → 4 failed
    (including the Reports-vanishes-from-the-menu assertion); restored → 45/45.
    Disabled the archetype block in `validateManifest` → 4 failed in
    `provisioning.test.ts`; restored → 55/55.
  - Not claimed: the remaining six bible §7 axes (scale, system-of-record,
    deployment, geography, industry, provider) are not declared — see
    PACK-020-001. `system-of-record` is being built separately as PACK-020-004's
    coexistence profile.

- [ ] **PACK-GATE-030** — Pack truth is versioned, contextual and enforced.
  - Status: FAIL
  - Children: 3 of 5 decided — `PACK-030-001` PASS (canonical pack objects,
    versions, signatures, lifecycle, scope), `PACK-030-004` PASS (deprecation,
    suspension, end-of-support, retirement), `PACK-030-005` PASS (UI/API never
    labels unsupported scope available); `PACK-030-002` FAIL (exact availability
    decisions) and `PACK-030-003` FAIL (dependencies, alternatives, conflicts,
    compatibility). Was "2 of 5" until PACK-030-005 landed, and "3 of 5" before
    that with PACK-030-003 wrongly counted as PASS — the number is written in the
    keyed form with each child named, because both spellings have been wrong here
    for different reasons.
  - Closed in this pass — the half of REVIEW-FINDINGS P0 #5 that was missing.
    `decide()` implemented the ordered tier comparison the finding demands
    (`tierRank` at `packages/authorization/src/decide.ts`, `current < required`
    rather than `current !== required`) and it could never fire: the only
    production builders of an `AuthorizationWorld` never set `entitlements`, so
    `tierRank` returned null, `required` was null, and the whole loop was a
    no-op on every request. A correct gate nothing supplies facts to is a gate
    that is off. Now: `budgeting` declares
    `tiers: ["budget", "ledger", "consolidation"]` (`modules/index.ts`),
    `finance.approver` declares `minTier: "ledger"`
    (`packages/authorization/src/role-templates.ts`), `TenantBinding` carries
    `currentTier` (`blueprints/types.ts`, set for the pilot in
    `blueprints/index.ts`), `tiersFor()` assembles both
    (`packages/platform-config/src/modules.ts`), and `seatWorld` /
    `institutionWorld` take it as a REQUIRED argument
    (`apps/web/src/lib/authz/seat-world.ts`) so no caller can reopen the hole.
    All three production callers pass it:
    `apps/web/src/app/(app)/orgs/[slug]/finance/actions.ts`,
    `apps/web/src/lib/resources-data.ts` and `apps/web/src/lib/relay-tools.ts`.
  - Tests: `npx jest --ci authz/seat-world.test` -> 23/23, including six in
    "the tier a tenant bought decides what the same bundle confers" — one of
    which builds its facts from the real `tiersFor("rochester")` rather than
    from a fixture.
  - Mutation: deleted the `entitlements` line from `seatWorld` -> the denial
    assertions failed (this is the assertion that proves the WIRING, not the
    engine); restored -> 23/23.
  - Mutation: reverted `current < required` to `current !== required` in
    `decide.ts` -> "allows a tenant ABOVE it, because tiers are ordered and not
    equal" failed in `seat-world.test` and the upgrade test failed in
    `authorization.test`; restored -> both green.
  - What the gate still needs: PACK-030-002's legal-entity/population/country
    scoping, and PACK-030-003's alternatives/compatibility half re-judged by a
    reader other than the one who fixed it. The UI/API label proof that used to
    be listed here is done — `tests/architecture/availability-labels-are-derived.test.mjs`,
    4/4, 5 mutations — and the gate is still FAIL, because a gate is proven by
    its children and two of five are open.

- [ ] **PACK-GATE-040** — Functional breadth is honest and depth is evidence-gated.
  - Status: FAIL
  - Children: 3 of 4 decided — `PACK-040-001` PASS (277 canonical registry
    entries for every §8 capability), `PACK-040-002` PASS (each mapped to owner,
    objects, states, controls, UI, integrations, tests and lifecycle),
    `PACK-040-004` PASS (75 declared gaps, tracked as advisories);
    `PACK-040-003` FAIL — complete vertical slices instead of shallow scaffolds,
    which is the DEPTH half this gate is named for.
  - Breadth is now honest in the sense the gate means: 262 of the 277 registered
    capabilities say `not-implemented`, and the 15 that do not say
    `certified-limited` because that is what their module's manifest says. Depth
    is not evidence-gated yet — no suite has a complete vertical slice — so the
    gate stays FAIL. Half a gate is not a gate.

- [ ] **PACK-GATE-050** — Industry labels resolve to implemented process/control differences, not branding.
  - Status: FAIL
  - Children: 1 of 4 decided — `PACK-050-004` PASS (regulated-industry
    disclaimers and hard availability gates); `PACK-050-001` FAIL (industry pack
    internal structure and schema validation), `PACK-050-003` FAIL (the three
    proving packs), and `PACK-050-002` FAIL — the §9 taxonomy of 57 industries is
    real and none of them is claimed, but the row was OVERTURNED on review
    because one of the three enforcement mechanisms it stated does not exist. Its
    row carries the refuter's finding.
  - The gate's own claim is the one thing the taxonomy deliberately does NOT
    make: that an industry label resolves to an implemented process or control
    difference. It cannot, because no industry pack exists — every one of the 57
    entries says `not-implemented`, which is the honest answer and is also why
    this gate cannot pass. It passes when PACK-050-001 gives a pack an internal
    structure and PACK-050-003 delivers one at declared scope; the taxonomy is
    the register those two will be judged against.

- [ ] **PACK-GATE-060** — Modules form coherent business systems.
  - Status: FAIL
  - Children: 1 of 4 decided. A gate is proven by its children. PACK-060-001
    (process-chain contracts) is PASS; PACK-060-002 (universal accounting
    events), PACK-060-003 (exceptions, compensation, reconciliation,
    drill-through) and PACK-060-004 (E2E chain tests across module boundaries)
    are open. Corrected from "0 of 4 are complete at the time of writing" —
    true when written, false once PACK-060-001 landed, and stated in a shape no
    checker could read. What follows is what landed against this gate, recorded
    so the next session does not rebuild it — not a claim that the gate is met.
  - Code/config: `packages/releases/src/validate.ts` (the `coherence` chain rule),
    `packages/platform-config/src/build-system.ts` (`systemUnderValidation`),
    consuming the `ProcessChain` declarations in `modules/index.ts` and
    `packages/module-runtime/src/resolve.ts`
  - Evidence: coherence checking stopped at set equality — the pinned key set
    against the enabled key set, in both directions, plus "the versions are
    non-empty". It never asked whether the enabled set constitutes a working
    business system, so a release enabling `approvals` with no `memory` validated
    clean: requests are accepted and the decision dies with the officers who made
    it. `validateSystem` now refuses, in the existing `area: "coherence"`
    category, every declared chain the enabled set STARTS and cannot finish,
    naming the first missing step, the event it would have consumed and the
    module that would supply it.
  - Only chains a system starts are enforced. A tenant that does not run
    approvals has not left that chain half-built; it is not in it. A check that
    fires on correct systems is one people learn to route around, and the
    nonprofit reference system is exactly such a system.
  - Wiring is falsifiable rather than asserted: `systemUnderValidation` is the one
    place the question is assembled, `buildSystem` puts its question through it,
    and `build-system.test.ts` puts the pilot's real assembled inputs — minus one
    chain step — through the identical function. Drop `chains` there and the test
    reds.
  - Mutation: skipped the chain gap loop in `validate.ts` → "refuses a system that
    starts a chain it cannot finish, naming the missing step" FAILED; restored.
    The assertion is on the problem's DETAIL text (`needs module "memory"`, and
    the chain id), not merely on `valid === false`, so the pre-existing
    `dependsOn` membership rule cannot pass the test on its own.



- [ ] **PACK-GATE-070** — Every pack behaves as a secure native Tenure product surface.
  - Status: FAIL
  - Reason: imported from `Tenure_ERP_Archetype_and_Specialized_System_Pack_Factory_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PACK-GATE-080** — Pack lifecycle is safe across the tenant fleet.
  - Status: FAIL
  - Children: 3 of 5 decided — PACK-080-001, PACK-080-003 and PACK-080-005 are
    PASS; PACK-080-002 and PACK-080-004 are FAIL. Corrected from "0 of 5
    children decided", which was true when written and false once three of them
    landed, and which named PACK-030-004 as FAIL when the ledger now has it
    PASS. A gate is proven by its children, and two of these are still open.
    Bible §19:643 requires global updates to reach Simon and all tenants through
    release compatibility **and** wave policies. The compatibility half is now
    reachable; the wave half — adoption, wave, canary, hold, rollback, forward
    recovery (PACK-080-002) — does not exist, so the gate cannot be closed.
  - What was built, and what it fixes:
    - **The fleet could not be asked which tenants run a module.** Every
      lifecycle question took one slug (`modulesFor`, `hasModule`), so
      deprecating or retiring a module could not be evaluated against the fleet
      before it was done. `tenantsRunning(moduleKey)` and `moduleAdoption()` in
      `packages/platform-config/src/modules.ts` fold every binding through the
      SAME `modulesFor` resolver each tenant runs, so the blast radius cannot
      disagree with what those tenants have.
    - **`checkCompatibility` had zero callers.** The function whose whole purpose
      is "a cell that is older refuses the release"
      (`packages/platform-config/src/compatibility.ts:92`) was reachable only
      from its own test, so no tenant had ever been checked against the engine
      running it. `compatibilityFor` / `fleetCompatibility` in
      `packages/platform-config/src/resolve.ts` are its first callers, and
      `apps/system-studio/src/app/platform/page.tsx` calls
      `fleetCompatibility(cell.release)` per cell in the fleet — so the version
      compared against is what the cell reports, and a cell that cannot say what
      it runs (`SCHEMA_VERSION` unset, i.e. `"unpinned"`) reports refusal rather
      than a reassuring pass.
    - Both are rendered on the Studio's Platform page: "Module adoption" (every
      module, its lifecycle, its command surfaces with risk class, and the
      tenants running it with `preset` / `edit` provenance) and "Release
      compatibility".
  - Tests: 9 cases in `packages/platform-config/src/modules.test.ts`
    ("the blast radius of a module lifecycle change", "a tenant's configuration
    against the engine version running it"). Run:
    `cd apps/web && npx jest platform-config/src/modules.test -t "blast radius"` → 5 passed;
    `... -t "against the engine version running it"` → 4 passed.
  - Evidence — 2 mutations, 2 caught:
    1. `tenantsRunning` reimplemented to read `compiledArchetypeFor(slug).modules`
       instead of the resolver → 3 tests FAIL. `tenantsRunning("budgeting")`
       returns `["rochester","midtown-arts","fixture-external-erp"]`, wrongly
       including `midtown-arts`, which has budgeting in its compiled preset and
       is refused it on entitlement; and `tenantsRunning("feed")` loses
       `fixture-rtl`, which runs feed only because of its own `moduleEdits`.
       Restored → 5 passed.
    2. `fixture-rtl.moduleEdits` emptied → "counts a module a tenant runs only
       because of its own edit" and "carries each tenant's provenance into the
       fleet view" both FAIL; restored → 5 passed.
  - Also proven while here (PACK-020-002's named mutation, same resolver):
    `rochester` given `moduleEdits: { add: [], remove: ["budgeting"] }` →
    `modulesFor("rochester").problems` becomes
    `[{ moduleKey: "reimbursements", reason: "missing-dependency", … }]` and the
    pilot's menu loses `Reports`; `midtown-arts` given `add: ["budgeting"]` →
    keys unchanged, still `missing-entitlement`, not granted.

- [ ] **PACK-GATE-090** — Specialized systems are deployable by configuration for exact proven scopes.
  - Status: FAIL
  - Reason: imported from `Tenure_ERP_Archetype_and_Specialized_System_Pack_Factory_Claude_Bible_v1.0.md`; not yet implemented
