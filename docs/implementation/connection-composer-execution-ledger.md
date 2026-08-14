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

- [ ] **CAT-010-001** — Implement all cardinality modes and count dimensions.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Deployer_Integration_Catalog_and_Tenant_Connection_Composer_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **CAT-010-002** — Distinguish connection instances, selected resources, entitled capacity, provisioned capacity, and usage.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Deployer_Integration_Catalog_and_Tenant_Connection_Composer_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **CAT-010-003** — Implement per-tenant/module/pack/capability/provider/dimension minimums, maximums, and redundancy.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Deployer_Integration_Catalog_and_Tenant_Connection_Composer_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **CAT-010-004** — Detect duplicate provider identities, missing coverage, unsafe reuse, unsupported mix, and fragmentation.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Deployer_Integration_Catalog_and_Tenant_Connection_Composer_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **CAT-010-005** — Prove examples with multi-Microsoft/Google tenants, Slack workspaces, Salesforce environments, ERP entities, banks, Stripe accounts, plants, and partners.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Deployer_Integration_Catalog_and_Tenant_Connection_Composer_Claude_Bible_v1.0.md`; not yet implemented

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
  - Reason: imported from `Tenure_Global_Deployer_Integration_Catalog_and_Tenant_Connection_Composer_Claude_Bible_v1.0.md`; not yet implemented

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
