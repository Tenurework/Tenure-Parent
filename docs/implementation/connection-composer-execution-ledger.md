# Global Deployer Integration Catalog and Tenant Connection Composer — execution ledger

Every `CAT-*` requirement stated by `Tenure_Global_Deployer_Integration_Catalog_and_Tenant_Connection_Composer_Claude_Bible_v1.0.md`.

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

- [x] **CAT-000-001** — Import every `CAT-*` requirement into the master execution ledger and document graph.
  - Status: PASS
  - Evidence:
    - `Tenure_Global_Deployer_Integration_Catalog_and_Tenant_Connection_Composer_Claude_Bible_v1.0.md` states 59 `CAT-*` requirements, including gates.
    - `docs/implementation/connection-composer-execution-ledger.md` carries all 59 `CAT-*` rows.
    - `tools/document-graph.mjs` now imports gate-shaped IDs through the same execution-system import detector as numbered IDs.
    - `tests/architecture/document-graph.test.mjs` asserts that every `CAT-*` Bible requirement appears in the execution system, has a connection-composer ledger row, and resolves to the catalog Bible in the generated registry.
    - Mutation proof: changing the ledger row `CAT-GATE-090` to `CAT-GATE-999` made `node --test tests/architecture/document-graph.test.mjs` fail on missing `CAT-GATE-090` and the unimported ratchet.
  - Tests: `node --test tests/architecture/document-graph.test.mjs`
  - Honest limit: This proves import and document-graph wiring only. It does not implement catalog inventory, provider lifecycle classification, UI configuration, connector runtime, certification, cost, or deployment behavior for the remaining `CAT-*` requirements.

- [x] **CAT-000-002** — Inventory every integration/app/system currently named, displayed, configured, coded, deployed, marketed, or used by a tenant.
  - Status: PASS
  - Code: `tools/cat-integration-inventory.mjs` derives the inventory from the tree; `docs/architecture/cat-integration-inventory.md` is its committed output.
  - Evidence:
    - 58 catalog rows, each naming the `file:line` that declares it — 24 connector packs (`packages/provisioning/src/provider-packs.ts`), 1 `ConnectorEntry` (`packages/provisioning/src/catalogs.ts:1083`), 2 model rows (`packages/platform-config/src/model-policy.ts`), 31 Stripe capability leaves (`packages/payments/src/capability-registry.ts`).
    - 47 hosts named in tracked non-test `.ts`/`.tsx` source, each marked `url` / `egress declaration` / `prose only`. 7 have no catalog row at all — `docs.aws.amazon.com`, `evil-tenure.app`, `null.console.aws.amazon.com`, `platform.tenurework.com`, `tenure.app`, `tenure.dev`, `www.googleapis.com` — which is the gap an inventory exists to surface.
    - 38 `@aws-sdk/client-*` packages, with the areas that import them.
    - Nothing is hand-listed: the file list comes from `git ls-files` (tracked only, POSIX paths, byte-sorted, `\r?\n` splitting), so the document is byte-identical on Linux and Windows.
    - Mutation 1 — deleted the `` `slack.workspace` `` row from the committed markdown: `node --test tests/architecture/cat-integration-inventory.test.mjs` went 10 pass / 0 fail → 9 pass / 1 fail ("the committed inventory is what the tree produces today"); restored → 10 pass / 0 fail.
    - Mutation 2 — deleted the entire `atlassian.jira` `pack({ … })` block from `packages/provisioning/src/provider-packs.ts`: 10/0 → 8 pass / 2 fail (inventory and classification freshness); restored → 10/0, bytes identical to the original.
    - Mutation 3 — added `https://telemetry.acme-vendor.io/v1` to `apps/web/src/lib/ai.ts`: 10/0 → 9 pass / 1 fail; restored → 10/0. An integration added to the code and not to the catalog cannot land silently.
  - Tests: `node --test tests/architecture/cat-integration-inventory.test.mjs` (10 tests; also runs under `npm run test:platform`)
  - Honest limit: the host scan covers tracked non-test `.ts`/`.tsx` under `apps/`, `packages/` and `modules/`; the AWS scan adds `tools/`. Neither reads Terraform, workflow YAML, or anything a tenant reaches that is named nowhere in source, and `marketed` is covered only insofar as marketing copy lives in those files. Reserved names (RFC 2606 / RFC 6761) and single-label placeholders are excluded by design.

- [x] **CAT-000-003** — Classify each provider/product/capability/direction/region/version with the exact catalog lifecycle.
  - Status: PASS
  - Code: `RULES` and `classify()` in `tools/cat-integration-inventory.mjs`; `docs/architecture/cat-lifecycle-classification.md` is the committed output.
  - Evidence:
    - The sixteen §6 states are PARSED from the Bible's own fenced block (`bibleLifecycles()`), not transcribed, so "the exact catalog lifecycle" is a fact about §6 rather than a constant.
    - All 58 rows classified, 0 unclassified, each with provider / product / capability / direction / region / version and the rule id that produced its state: `PLANNED` 48, `IN_DEVELOPMENT` 3, `UNSUPPORTED` 7.
    - Region is what each row actually declares — `partition:aws` for `tenure.relay-anthropic`, `*` for the two model rows, `not declared` for the packs. Version is the declared engine range (`>=2026.1.0`) or the pinned provider API version (`api 2026-03-31`).
    - No rule can emit a state above `IN_DEVELOPMENT` except R4, which is gated on a submitted provider review; `RELAY_ANTHROPIC_REVIEW.state` is `NOT_SUBMITTED` (`packages/platform-config/src/provider-review.ts:207`), so nothing in this tree reaches `SANDBOX_VALIDATED`, `TENURE_CERTIFIED` or `TENANT_ELIGIBLE`. A test asserts that ceiling directly.
    - Mutation 4 — removed `SANDBOX_VALIDATED` from the Bible's §6 block: 10 pass / 0 fail → 8 pass / 2 fail ("the classification vocabulary is the Bible's, read from the Bible" and the classification freshness test); restored → 10/0, bytes identical.
    - Mutation 2 above also reds this document, because a pack removed from the source removes a classified row.
  - Tests: `node --test tests/architecture/cat-integration-inventory.test.mjs`
  - Honest limit: the classification is derived from what each row DECLARES, not from an independent audit of the connector. It records that no row can be evidenced past `IN_DEVELOPMENT`; it does not prove the three `IN_DEVELOPMENT` rows work.

- [x] **CAT-000-004** — Bind Catalog requirements to Configurator, Pack Factory, Integration Plane, Work Graph, Payments, core domains, System Studio, Tenant UX, and release evidence.
  - Status: PASS
  - Code: `tools/cat-requirement-bindings.mjs`; `docs/architecture/cat-requirement-bindings.md` is the committed output.
  - Evidence:
    - The 9 surfaces are parsed out of CAT-000-004's own sentence in the Bible (`surfaceNames()`), and the test asserts set equality with the binding table in BOTH directions — a table that drops one or invents a tenth reds.
    - All 59 `CAT-*` requirements in this ledger are bound, via their phase (10 phases; each gate resolves to the phase it closes). Each phase names the surfaces it needs and why.
    - Every binding target is a path the test opens: 13 governing Bibles, 9 ledgers, 20 source anchors — 42 paths, all present.
    - Mutation 5 — repointed the Work Graph surface's ledger to `docs/implementation/universal-work-graph-execution-ledgerX.md`: `node --test tests/architecture/cat-requirement-bindings.test.mjs` went 7 pass / 0 fail → 5 pass / 2 fail ("every target the bindings name exists", plus freshness); restored → 7/0.
    - Mutation 6 — removed the `CAT-060` entry from `PHASE_BINDINGS`: 7/0 → 5 pass / 2 fail ("every CAT requirement in the ledger is bound to a phase" naming `CAT-060-001`…`CAT-GATE-060`, plus freshness); restored → 7/0.
  - Tests: `node --test tests/architecture/cat-requirement-bindings.test.mjs` (7 tests)
  - Honest limit: the binding is at PHASE granularity — five requirements in a phase share its surfaces — and it is stated as such in the document. It records where each requirement's work is jointly owned; it does not implement any of it. Every `CAT-*` requirement outside `CAT-000` remains `FAIL`.

- [x] **CAT-010-001** — Implement all cardinality modes and count dimensions.
  - Status: PASS
  - Code: `packages/provisioning/src/connection-cardinality.mjs` (909 lines) exports
    `CARDINALITY_MODES` (14), `COUNT_DIMENSIONS` (16), `COUNT_KINDS` (5),
    `DETECTIONS` (9), `DETECTIONS_DEFERRED` (5), `dimensionById`,
    `cardinalityVerdict`, `countLedger`, `instancesFor`, `requirementFindings`,
    `limitFindings`, `assessPortfolio`, `known`, `unknown`. Every one of the
    fourteen modes has its own `case` in `cardinalityVerdict` — there is no
    shared "count ≥ n" fallback, because `ONE_PER_DIMENSION_VALUE`,
    `ALL_SELECTED_PROVIDERS`, `PRIMARY_PLUS_BACKUP`, `PER_USER_REQUIRED` and
    `DISCOVERED_THEN_APPROVED` are not questions about a count at all.
  - Caller: `tools/cat-connection-counts.mjs:37` (the generator behind
    `docs/architecture/cat-connection-count-examples.md`),
    `tests/architecture/cat-cardinality-covers-the-bible.test.mjs:14`,
    `tests/architecture/cat-connection-counting.test.mjs:12`. No application
    surface consumes it — see the honest limit.
  - Tests: `node --test tests/architecture/cat-cardinality-covers-the-bible.test.mjs` — 9 tests, 9 pass, 0 fail.
  - Evidence:
    - The vocabulary is PARSED out of the Bible, not transcribed: `bibleModes()`
      reads the fourteen backticked names between `### 1.1 Cardinality modes` and
      `Count dimensions include:`, `bibleDimensions()` the sixteen bullets after
      it, and the test asserts `deepEqual` against the engine's constants — so a
      mode dropped from the engine AND a mode the engine invents both red.
    - "every declared mode has an evaluator" drives all fourteen against a fully
      declared requirement and asserts `determinable === true`, which is what
      makes "implement" mean more than "list".
    - Mutation M9 — deleted `"PRIMARY_PLUS_BACKUP",` from `CARDINALITY_MODES`:
      `9 pass / 0 fail` → `8 pass / 1 fail`, `not ok - the engine implements
      exactly §1.1's cardinality modes, in order`; restored → `9 pass / 0 fail`,
      bytes identical after restore: true.
    - Mutation M3 — `needs(n, "cardinality.n")` → `needs(n ?? 1, …)` in the
      `EXACTLY_N` branch, i.e. a requirement that never said how many silently
      becomes a requirement for one: `26 pass / 0 fail` → `25 pass / 1 fail`,
      `not ok - a mode missing its parameter is undeterminable, and names the
      field`; restored → `26 pass / 0 fail`.
  - Honest limit: this is the count ENGINE and its vocabulary. Nothing renders it
    to an operator: the Deployer's integration step does not exist (CAT-020,
    CAT-040), so the engine's readers today are the generator that writes the
    worked-examples document and the two platform guards. It is deliberately
    `.mjs` rather than `.ts` because both of those readers run on Node 20, where
    TypeScript cannot be loaded — the package's `main`/`exports` are unchanged and
    still TypeScript-only, so no application import path is affected either way.

- [x] **CAT-010-002** — Distinguish connection instances, selected resources, entitled capacity, provisioned capacity, and usage.
  - Status: PASS
  - Code: `countLedger()` and `COUNT_KINDS` in
    `packages/provisioning/src/connection-cardinality.mjs`. Five separate
    readings, each `{ known: true, value }` or `{ known: false, why }` — the same
    shape as `apps/system-studio/src/app/tenants/[slug]/summary.ts`'s
    `Reading<T>`, so a console cannot mistake a zero for a blank.
  - Caller: `tools/cat-connection-counts.mjs:37` renders all five for each of the
    eleven scenarios; `assessPortfolio()` returns it as `ledger`.
  - Tests: `node --test tests/architecture/cat-connection-counting.test.mjs` — 26 tests, 26 pass, 0 fail.
  - Evidence:
    - §1's closing prohibition is a test: one connection with 40 selected
      mailboxes reads `connection_instances 1 / selected_resources 40`. The Slack
      and Stripe arms are in the generated document — 3 workspace connections and
      23 channels; 3 connected accounts and 6 resources, with no tenant count
      anywhere in the ledger.
    - An undeclared selection is `known: false` naming the instances; a declared
      empty one is `known: true, value: 0`.
    - Mutation M1 — `connection_instances: known(instances.length)` →
      `known(instances.reduce((t, i) => t + (i.selectedResources?.length ?? 1), 0))`,
      which is the SharePoint miscount exactly: `26 pass / 0 fail` →
      `23 pass / 3 fail`, `not ok - forty mailboxes under one connection are one
      connection and forty resources`, `not ok - the five counts move
      independently — none is derived from another`, `not ok - the committed
      examples document is what the engine produces today`; restored →
      `26 pass / 0 fail`, bytes identical after restore: true.
    - Mutation M2 — `if (missing.length > 0) {` → `if (false) {` in
      `sumDeclared`, so a portfolio with one unsized instance sums the rest:
      `26 pass / 0 fail` → `24 pass / 2 fail`, `not ok - one unsized instance
      makes the portfolio's capacity unknown, not the sum of the rest`; restored →
      `26 pass / 0 fail`.
  - Honest limit: entitled, provisioned and active capacity are DECLARATIONS on
    each connection instance. Nothing here reads a contract, an AWS account or a
    running connector, so all three are `known: false` for every scenario that
    does not declare them, which is the truthful reading and not a measurement.
    Wiring them to real readings is CAT-030-002 (capacity plan) and CAT-090-001.

- [x] **CAT-010-003** — Implement per-tenant/module/pack/capability/provider/dimension minimums, maximums, and redundancy.
  - Status: PASS
  - Code: `limitFindings()` and `LIMIT_GRAINS` in
    `packages/provisioning/src/connection-cardinality.mjs` bind minimums and
    maximums at all six grains the sentence names — `limits.tenant`,
    `limits.byModule`, `limits.byPack`, `limits.byCapability`,
    `limits.byProvider`, `limits.byDimension` (per dimension VALUE). Redundancy is
    the `unsafe_concentration` arm of `requirementFindings()` plus the
    `PRIMARY_PLUS_BACKUP` evaluator.
  - Caller: `assessPortfolio()` calls `limitFindings` on every portfolio;
    `tools/cat-connection-counts.mjs` scenario `example-portfolio-limits` drives
    all six and the document shows one finding per grain.
  - Tests: `node --test tests/architecture/cat-connection-counting.test.mjs` — 26 tests, 26 pass, 0 fail.
  - Evidence:
    - "minimums and maximums bind at all six grains" asserts the set of grains in
      the findings is exactly `["capability", "dimension", "module", "pack",
      "provider", "tenant"]`.
    - Redundancy is not satisfied by arithmetic: a backup on the primary's own
      `providerIdentity` is refused by the mode AND reported as
      `unsafe_concentration` — "The same account failing takes both paths with
      it." The banks scenario is exactly that portfolio.
    - A per-grain count counts INSTANCES, not requirements: two requirements
      sharing one capability and one connection produce no `above_maximum` at
      `byModule: { collaboration: { maximum: 1 } }`.
    - A limit declared on a dimension §1.1 does not name is refused
      (`determinable: false`) rather than applied or dropped.
    - Mutation M8 — deleted the `byPack` entry from `LIMIT_GRAINS`:
      `26 pass / 0 fail` → `23 pass / 3 fail`, `not ok - minimums and maximums
      bind at all six grains, each with its own finding`, `not ok - each worked
      example produces exactly the findings it was written to produce`, `not ok -
      the committed examples document is what the engine produces today`;
      restored → `26 pass / 0 fail`, bytes identical after restore: true.
  - Honest limit: the limits arrive as an argument. Nothing yet derives them from
    a plan, an entitlement record or a module manifest — that binding is
    CAT-090-002 ("plan/entitlement/capacity/usage count enforcement without
    confusing them"), and until it lands a real tenant's maxima live nowhere.

- [x] **CAT-010-004** — Detect duplicate provider identities, missing coverage, unsafe reuse, unsupported mix, and fragmentation.
  - Status: PASS
  - Code: `requirementFindings()` in
    `packages/provisioning/src/connection-cardinality.mjs` emits
    `duplicate_provider_identity`, `missing_dimension_coverage`,
    `unsafe_reuse_across_boundary`,
    `personal_grant_for_organization_requirement`, `unsupported_provider_mix` and
    `excessive_fragmentation`; `DETECTIONS` carries the §4.2 bullet each one
    closes and `DETECTIONS_DEFERRED` names the five §4.2 bullets this engine
    refuses to decide, with what each needs and that CAT-030-003 owns it.
  - Caller: `assessPortfolio()`; the generated document shows every code firing
    on a scenario written for it.
  - Tests: `node --test tests/architecture/cat-connection-counting.test.mjs` (26 pass) and
    `node --test tests/architecture/cat-cardinality-covers-the-bible.test.mjs` (9 pass).
  - Evidence:
    - Duplicates are detected by VERIFIED PROVIDER IDENTITY, per §2.3 — two Entra
      tenants under one capability produce no finding, and the same tenant
      connected twice produces `duplicate_provider_identity` naming both
      instance ids.
    - Unsafe reuse and personal-grant policy are REQUIRED declarations, not
      defaults. A requirement with no `scope.separation` gets a finding whose
      `determinable` is `false` and whose text says "This is undeterminable, not
      safe" — because defaulting it would decide a data-residency question in
      code, for every tenant, silently.
    - Fragmentation is assessed only against a declared count dimension and
      reports `{ assessed: false, reason }` otherwise, rather than guessing a
      threshold. It fires on two DISTINCT identities serving one dimension value
      and not on one identity twice (that is the duplicate finding) and not on two
      identities serving two values.
    - `DETECTIONS` + `DETECTIONS_DEFERRED` is asserted set-equal to §4.2's
      fourteen parsed bullets in both directions, so implementing nine and
      claiming fourteen is impossible; so is quietly shortening the list.
    - Mutation M4 — the duplicate map keyed on `providerProduct` instead of
      `providerIdentity`: `26 pass / 0 fail` → `22 pass / 4 fail`, `not ok - two
      Entra tenants are not duplicates; the same tenant twice is` (plus
      fragmentation, worked-example and document-freshness); restored →
      `26 pass / 0 fail`.
    - Mutation M6 — `requirement.scope?.separation` → `… ?? {}`:
      `26 pass / 0 fail` → `25 pass / 1 fail`, `not ok - undeclared separation
      reports that reuse could not be assessed — it does not pass`; restored →
      `26 pass / 0 fail`.
    - Mutation M7 — `if (identities.length > 1)` → `if (group.length > 1)` in the
      fragmentation arm: `26 pass / 0 fail` → `25 pass / 1 fail`, `not ok - two
      Entra tenants are not duplicates; the same tenant twice is`; restored →
      `26 pass / 0 fail`.
    - Mutation M10 — deleted the "a provider instance with no capability
      consumer" entry from `DETECTIONS_DEFERRED`: `9 pass / 0 fail` →
      `8 pass / 1 fail`, `not ok - decided plus deferred detections are exactly
      §4.2's fourteen bullets`; restored → `9 pass / 0 fail`.
    - Mutation M11 — disabled the personal-grant arm by changing its comparison
      literal to `"organization-wide-never-declared"`: `26 pass / 0 fail` →
      `22 pass / 4 fail`, including `not ok - every detection this engine claims
      to decide is exercised by a worked example`; restored → `26 pass / 0 fail`.
    - Mutation M12 — `verdict.uncovered.length > 0` → `> 99`:
      `26 pass / 0 fail` → `22 pass / 4 fail`; restored → `26 pass / 0 fail`.
  - Honest limit: nine of §4.2's fourteen conditions. The five in
    `DETECTIONS_DEFERRED` need a capability-consumer graph, module/pack connector
    requirements, field-level system-of-record ownership, owner records with
    departure dates, and cost/licence/review state — none of which this function
    is given, all of which CAT-030-003 must supply. Detection also runs on
    DECLARED portfolios; nothing here reaches a provider to verify that an
    identity is what it says it is.

- [x] **CAT-010-005** — Prove examples with multi-Microsoft/Google tenants, Slack workspaces, Salesforce environments, ERP entities, banks, Stripe accounts, plants, and partners.
  - Status: PASS
  - Code: `tools/cat-connection-counts.mjs` (631 lines) declares `SCENARIOS` —
    eleven portfolios covering the eight subjects the sentence names — and renders
    `docs/architecture/cat-connection-count-examples.md` (231 lines) from the
    engine's own output. Nothing in that document is transcribed.
  - Caller: `node tools/cat-connection-counts.mjs` writes the document;
    `tests/architecture/cat-connection-counting.test.mjs:13` imports `SCENARIOS`,
    `results` and `render` and asserts both the verdicts and the committed bytes.
    The generator writes ONLY when it is the process entry point
    (`path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)`), so
    importing it under `--test` cannot modify the tree the other guards are
    scanning.
  - Tests: `node --test tests/architecture/cat-connection-counting.test.mjs` — 26 tests, 26 pass, 0 fail.
  - Evidence:
    - Coverage of the sentence is asserted by name: the test iterates
      `["multi-Microsoft tenants", "multi-Google tenants", "Slack workspaces",
      "Salesforce environments", "ERP entities", "banks", "Stripe accounts",
      "plants", "partners"]` and fails on any subject no scenario covers.
    - Every scenario DECIDES: `assessment.undeterminable === 0` for all eleven, so
      a worked example cannot be "proved" by an engine that shrugged.
    - Each scenario's findings are pinned exactly — e.g.
      `example-salesforce-environments` → `["missing_dimension_coverage",
      "unsafe_reuse_across_boundary"]`, `example-bank-channels` →
      `["duplicate_provider_identity", "unsafe_concentration"]`,
      `example-partners` → `["below_minimum"]` (2 approved of 3 required, with
      two discovered instances that do not count).
    - Every code in `DETECTIONS` is required to fire in at least one scenario, so
      a claimed detector with no witness reds. That test is what forced
      `example-unsupported-provider-mix` into existence — `unsupported_provider_mix`
      was declared and demonstrated nowhere until it was written.
    - Determinism: the same portfolio assessed twice is JSON-identical, which is
      the property the document's freshness check depends on.
    - Mutation M13 — hand-edited the committed document ("The 52 mailboxes under
      them are selected resources" → "… are 52 connections"):
      `26 pass / 0 fail` → `25 pass / 1 fail`, `not ok - the committed examples
      document is what the engine produces today`; restored →
      `26 pass / 0 fail`, bytes identical after restore: true.
    - Mutation M5 — `approved.length >= floor` → `carried.length >= floor` in
      `DISCOVERED_THEN_APPROVED`, so a discovery sweep satisfies a requirement:
      `26 pass / 0 fail` → `24 pass / 2 fail`, `not ok - DISCOVERED_THEN_APPROVED
      counts approved instances only`; restored → `26 pass / 0 fail`.
  - Honest limit: these are SPECIFICATION scenarios, not tenant data — every id is
    prefixed `example-` and no scenario names a real customer, provider account or
    credential. They prove the arithmetic and the detections over declared
    portfolios of those shapes. They do not prove a connector to Microsoft,
    Google, Slack, Salesforce, SAP, a bank, Stripe, an MES or an AS2 endpoint
    exists: `docs/architecture/cat-lifecycle-classification.md` still records
    every provider row at `PLANNED` or `IN_DEVELOPMENT` (CAT-000-003), and
    CAT-050/060/070/080 are the requirements that would change that.

- [ ] **CAT-020-001** — Implement all thirteen integration configuration sections from declarative schemas.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Deployer_Integration_Catalog_and_Tenant_Connection_Composer_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **CAT-020-002** — Implement conditional branches for provider, scope, domain, geography, system of record, Relay, privacy, and certification.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Deployer_Integration_Catalog_and_Tenant_Connection_Composer_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **CAT-020-003** — Implement repeatable connection-instance cards and reviewed bulk landscape import.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Deployer_Integration_Catalog_and_Tenant_Connection_Composer_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **CAT-020-004** — Implement field/section/aggregate state, save/resume/back/forward, branches, review, history, and downstream invalidation.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Deployer_Integration_Catalog_and_Tenant_Connection_Composer_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **CAT-020-005** — Preserve stale instances and explain migration/retirement impact rather than silently deleting them.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Deployer_Integration_Catalog_and_Tenant_Connection_Composer_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **CAT-030-001** — Implement every required desired-state object and signed tenant integration portfolio.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Deployer_Integration_Catalog_and_Tenant_Connection_Composer_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **CAT-030-002** — Compile connector release, app-registration, placement, token, queues/workers, storage/index, network, SLO, capacity, cost, test, cutover, lifecycle, and evidence plans.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Deployer_Integration_Catalog_and_Tenant_Connection_Composer_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **CAT-030-003** — Implement deterministic count/coverage/dependency/ownership/certification validation.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Deployer_Integration_Catalog_and_Tenant_Connection_Composer_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **CAT-030-004** — Generate desired/planned/actual diffs and drift reconciliation.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Deployer_Integration_Catalog_and_Tenant_Connection_Composer_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **CAT-030-005** — Prove the same approved manifest compiles deterministically and a changed upstream choice produces an explainable diff.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Deployer_Integration_Catalog_and_Tenant_Connection_Composer_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **CAT-040-001** — Implement Integration Portfolio view, capability coverage, counts, instance cards/table, dependencies, SoR topology, cost, blockers, and readiness.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Deployer_Integration_Catalog_and_Tenant_Connection_Composer_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **CAT-040-002** — Implement recommended safe configuration, progressive disclosure, advanced mode, and impact preview.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Deployer_Integration_Catalog_and_Tenant_Connection_Composer_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **CAT-040-003** — Implement plain-language questions and exact “configured N of M required” status.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Deployer_Integration_Catalog_and_Tenant_Connection_Composer_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **CAT-040-004** — Implement Relay proposals/explanations without granting it consent, approval, activation, or waiver authority.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Deployer_Integration_Catalog_and_Tenant_Connection_Composer_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **CAT-040-005** — Pass accessibility, keyboard, screen-reader, zoom/reflow, high contrast, reduced motion, localization/RTL, responsive, and long-session usability.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Deployer_Integration_Catalog_and_Tenant_Connection_Composer_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **CAT-050-001** — Register every provider/product family in section 8.1 with exact lifecycle and capabilities.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Deployer_Integration_Catalog_and_Tenant_Connection_Composer_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **CAT-050-002** — Execute Wave 1 only through the Universal Work Graph provider-pack requirements.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Deployer_Integration_Catalog_and_Tenant_Connection_Composer_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **CAT-050-003** — Register and prioritize Wave 2 work-management/content/meeting/signature systems.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Deployer_Integration_Catalog_and_Tenant_Connection_Composer_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **CAT-050-004** — Prove unbuilt catalog entries cannot generate connect/deploy/available states.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Deployer_Integration_Catalog_and_Tenant_Connection_Composer_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **CAT-060-001** — Register CRM, revenue, marketing, service, and communication systems from sections 8.2.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Deployer_Integration_Catalog_and_Tenant_Connection_Composer_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **CAT-060-002** — Register ERP, accounting, Finance, EPM, spend, tax, treasury, banking, and payment systems from section 8.3.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Deployer_Integration_Catalog_and_Tenant_Connection_Composer_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **CAT-060-003** — Register HCM, payroll, recruiting, learning, benefit, scheduling, and workforce systems from section 8.4.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Deployer_Integration_Catalog_and_Tenant_Connection_Composer_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **CAT-060-004** — Register identity, IT, security, developer, observability, incident, data, BI, integration, database, and file systems from sections 8.5–8.6.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Deployer_Integration_Catalog_and_Tenant_Connection_Composer_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **CAT-060-005** — Bind protected domains to their complete owning Bibles and external certification.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Deployer_Integration_Catalog_and_Tenant_Connection_Composer_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **CAT-070-001** — Register commerce/retail/hospitality systems from section 8.7.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Deployer_Integration_Catalog_and_Tenant_Connection_Composer_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **CAT-070-002** — Register supply-chain/logistics/EDI/trade systems from section 8.8.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Deployer_Integration_Catalog_and_Tenant_Connection_Composer_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **CAT-070-003** — Register manufacturing/engineering/asset/quality/lab systems from section 8.9.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Deployer_Integration_Catalog_and_Tenant_Connection_Composer_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **CAT-070-004** — Register healthcare/life-sciences systems from section 8.10.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Deployer_Integration_Catalog_and_Tenant_Connection_Composer_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **CAT-070-005** — Register construction/real-estate/field-service systems from section 8.11.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Deployer_Integration_Catalog_and_Tenant_Connection_Composer_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **CAT-070-006** — Register education/nonprofit/public-sector systems from section 8.12.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Deployer_Integration_Catalog_and_Tenant_Connection_Composer_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **CAT-070-007** — Enforce safety, regulated-data, institutional-approval, and “connector is not system replacement” boundaries.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Deployer_Integration_Catalog_and_Tenant_Connection_Composer_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **CAT-080-001** — Enforce every provider-pack minimum specification in section 9.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Deployer_Integration_Catalog_and_Tenant_Connection_Composer_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **CAT-080-002** — Bind provider/API/scope/review/version/region/edition changes to recertification.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Deployer_Integration_Catalog_and_Tenant_Connection_Composer_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **CAT-080-003** — Require exact sandbox/test-tenant, negative, volume, outage, lifecycle, and rollback proof.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Deployer_Integration_Catalog_and_Tenant_Connection_Composer_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **CAT-080-004** — Publish exact objects/actions/events/directions and known limitations per available pack.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Deployer_Integration_Catalog_and_Tenant_Connection_Composer_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **CAT-090-001** — Implement portfolio cost/capacity estimates with low/base/high assumptions and attribution.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Deployer_Integration_Catalog_and_Tenant_Connection_Composer_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **CAT-090-002** — Implement plan/entitlement/capacity/usage count enforcement without confusing them.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Deployer_Integration_Catalog_and_Tenant_Connection_Composer_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **CAT-090-003** — Run tenant portfolio go-live gates for required versus optional connectors.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Deployer_Integration_Catalog_and_Tenant_Connection_Composer_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **CAT-090-004** — Bind catalog, desired state, connector releases, provider applications/reviews, config, IaC, mappings, tests, evidence, cutover, support, and rollback into the platform release.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Deployer_Integration_Catalog_and_Tenant_Connection_Composer_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **CAT-090-005** — Produce the final tenant Integration Portfolio, exact count/coverage matrix, blocked gaps, cost, certification, and lifecycle report.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Deployer_Integration_Catalog_and_Tenant_Connection_Composer_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **CAT-GATE-000** — The catalog is complete as a planning inventory and honest about implementation.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Deployer_Integration_Catalog_and_Tenant_Connection_Composer_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **CAT-GATE-010** — The Deployer can correctly configure how many of each integration a tenant needs.
  - Status: FAIL
  - Reason: 5 of 5 child requirements (CAT-010-001…CAT-010-005) are PASS, and the
    gate is still FAIL, because the gate's subject is **the Deployer** and not the
    count engine. The engine decides counts correctly and is proven to; nothing
    lets an operator CONFIGURE one. There is no integration step in
    `apps/system-studio/src/app/tenants/new/`, and no
    `IntegrationCapabilityRequirement` or `ConnectionInstance` model in
    `apps/web/prisma/schema.prisma` — the one connection-shaped model there,
    `ConnectionLaunchToken` (schema.prisma:1654), is a single-use redeemable link
    for a person who was blocked on a capability, not a configured connection.
    Meanwhile
    `apps/web/src/lib/connections/capability-resolution.ts` says so in its own
    header — "`Connection` and `ConnectionOpportunity` (WRK-010-001) exist in no
    package and no migration in this repository". So a configured count cannot be
    entered, stored or read back.
  - What would close it: CAT-020-001/003 (the thirteen schema-driven sections and
    the repeatable connection-instance cards), CAT-020-004 (state, save/resume,
    downstream invalidation), CAT-040-001/003 (the Integration Portfolio view and
    the exact "configured N of M required" status), and the persistence those
    need — which is a schema change this wave did not make and must not invent.
    Requires: a `ConnectionInstance` / `IntegrationCapabilityRequirement` model
    reviewed by a human, per the no-unverified-migrations rule.

- [ ] **CAT-GATE-020** — Operators can configure complex portfolios safely without hard-coded forms or hidden state.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Deployer_Integration_Catalog_and_Tenant_Connection_Composer_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **CAT-GATE-030** — Integration choices become safe executable desired state, not prose or UI-only configuration.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Deployer_Integration_Catalog_and_Tenant_Connection_Composer_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **CAT-GATE-040** — Global Deployer integration configuration is powerful, fast, understandable, and non-fatiguing.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Deployer_Integration_Catalog_and_Tenant_Connection_Composer_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **CAT-GATE-050** — Major workspace systems are visible for planning and exact when enabled.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Deployer_Integration_Catalog_and_Tenant_Connection_Composer_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **CAT-GATE-060** — Horizontal enterprise breadth is cataloged without bypassing domain depth.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Deployer_Integration_Catalog_and_Tenant_Connection_Composer_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **CAT-GATE-070** — Specialized ERP packs can declare real integration requirements across major industries.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Deployer_Integration_Catalog_and_Tenant_Connection_Composer_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **CAT-GATE-080** — No generic happy path or SDK installation qualifies as a connector.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Deployer_Integration_Catalog_and_Tenant_Connection_Composer_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **CAT-GATE-090** — The Global Deployer can configure, cost, deploy, verify, and operate the right number of integrations for each tenant.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Deployer_Integration_Catalog_and_Tenant_Connection_Composer_Claude_Bible_v1.0.md`; not yet implemented
