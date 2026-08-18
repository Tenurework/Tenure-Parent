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
  - Code: `tools/cfg-configuration-truth.mjs` derives the inventory from `git ls-files` plus `git ls-files --others --exclude-standard`, and writes `docs/architecture/cfg-configuration-truth.md` — rows across the eight axes the requirement names plus the ninth. As regenerated on 2026-08-17: 208 rows — 25 System Studio routes, 12 authentication/authorization modules, 66 configuration and form modules, 4 database facts (the Postgres schema, its migrations, the Studio's DynamoDB tables, the config store adapter), 37 IaC files, 18 workflows with their production-disarm state, 43 tests over the configuration surface, 3 nonproduction findings. Every number here is DERIVED, so it moves whenever the tree moves and the guard reds until the document is regenerated; the figures first recorded against this row (198 rows, 23 routes, 64 modules, 36 IaC files, 17 workflows, 39 tests) were the tree of 2026-08-11. Regenerate with `node tools/cfg-configuration-truth.mjs`.
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
  - What now exists, so the next wave does not rebuild it: the RULE vocabulary and namespacing are done. `packages/configuration/src/graph-snapshot.ts:94` declares `RULE_SLOTS` — `visibleWhen`, `enabledWhen`, `requiredWhen`, `applicableWhen`, `validateWhen`, `deriveFrom` — each with an audience and a required result type, and `compileGraph` enforces namespacing in both directions: a package may not declare an id outside its own namespace, and a rule may not read a node outside its package's transitive closure.
  - What is missing, precisely. Bible §9 names seven vocabularies and this closes one and a half of them. Absent: `optionsFrom` (static / registry / query / external-check option sources), `invalidateWhen`, `approveWhen`, `lockWhen`, `redactWhen`, `mapsTo`, `affects` and `explainWith` from the §9 table; the STRUCTURAL vocabulary, which §9 says should be JSON Schema 2020-12 semantics (this compiler types a node as one of the four scalar `ExprType`s and has no object, array, string-format or range vocabulary at all); the UI vocabulary beyond the three presentation slots; and the provenance, impact, output and approval vocabularies, which are CFG-040-002, CFG-070-003, CFG-090-001 and CFG-080-001 respectively and are all FAIL.
  - Why it is not being stretched to PASS here: adding six empty slots to `RULE_SLOTS` would compile, would type-check, and would validate nothing, which is the shape of check that reads green and proves nothing. Each remaining slot needs the thing it decides to exist — `approveWhen` needs an approval policy engine (CFG-080), `mapsTo` needs artifact generation (CFG-090), `optionsFrom` needs the typed external-check runtime (CFG-070-002).
  - Unblock with: the structural half first, since everything else references it — either adopt `zod` (already a dependency, and `ConfigDefinition.type` in `packages/configuration/src/definition.ts:41` is a `ZodType`) or a JSON Schema 2020-12 validator, and widen `ExprType`/`DeclaredNode.type` to carry it. That widening touches `expression.ts`'s type checker and so is a change to a module three families' ledgers now cite; it wants its own wave, not a corner of this one.

- [ ] **CFG-020-002** — Implement bounded expression parsing, static typing, dependency extraction and deterministic evaluation.
  - Status: FAIL
  - Overturned on review: All five mutations reproduce exactly, one at a time, each restored byte-identical with 38/38 green after (round half-away-from-zero = 1 failed/37; FORBIDDEN_SEGMENTS 'constructor' = 1/37 'refuses the constructor walk that reaches Function'; dependencies `return walk(n.otherwise)`→`return` = 1/37; maxDepth 32→100000 = 1/37; typeOf var `if (!type)`→path-compare = 1/37). expression.ts is real, reached (rejections.ts:249 unsafeExpressions and graph-snapshot.ts:478/491/514/844). It is nonetheless closed against a narrower reading of its authority. Bible §10 'Safe expression language' (lines 349-364) defines what bounded/typed/deterministic means here, and four of its bullets are absent: (a) the bounds it names are 'evaluation budget, maximum depth, maximum collection size and timeout' — the code has maxLength/maxTokens/maxDepth/maxSteps (DEFAULT_LIMITS, expression.ts:57) with NO collection-size bound and NO timeout, so the claim's 'bounded in four dimensions' substitutes its own four for the Bible's four; (b) 'collection any, all, none, count, contains and safe projections' — FUNCTIONS (expression.ts:232) is min/max/abs/floor/ceil/round/len/lower/upper and contains(string,string); the language has no collection type at all, which is also why a collection bound is missing; (c) 'explicit time and effective-date input, never implicit wall-clock reads during replay' — there is no time or effective-date input in the AST, the function set or ValueEnv; (d) 'property-based tests and denial tests' — the denial tests exist and are good, the property-based tests do not (the closest thing is a 20-iteration repeat of one expression at expression.test.ts:163). Approved context functions from §10 (selected, capability, jurisdiction, entitled, certified, hasRole, hasEvidence, externalStatus, costEstimate, actualState) also do not exist; context arrives only as caller-declared flat paths.
  - Code: `packages/configuration/src/expression.ts` — `tokenize`, `parse`, `typeOf`, `dependencies`, `evaluate`, `run`, `expressionCycles`, `FUNCTIONS`, `DEFAULT_LIMITS`, `EXPRESSION_LANGUAGE_VERSION`. It was built for GE-031-005 and it is exactly what this requirement's four clauses ask for, so this row cites it rather than writing a second one — a second expression parser would be the defect, not the contribution. **Bounded** in four dimensions, each caught where it is cheapest (`maxLength` 2000 before the tokenizer runs, `maxTokens` 400, `maxDepth` 32 to guard the host stack during PARSING, which a step counter cannot, `maxSteps` 2000 as the cost limit). **Statically typed** before anything runs: `typeOf` refuses `1 + true`, cross-type comparison, truthiness, a conditional whose branches disagree, and every arity/argument mismatch in the fixed function set. **Dependency extraction** is `dependencies(node)`, which walks every branch including the one not taken. **Deterministic**: no clock, no randomness, no locale (`lower`/`upper` are deliberately not locale-aware), `round` is stated as half-away-from-zero rather than inherited from `Math.round`, division by zero and any non-finite result are refused so nothing non-finite can enter a digest.
  - Caller: `packages/configuration/src/rejections.ts:249` (`unsafeExpressions` parses and types every `${…}` template found in a proposed layer) and — new in this wave — `packages/configuration/src/graph-snapshot.ts:478`, `:491`, `:514` (the graph compiler's §11 steps 3–5) and `:844`–`:848` (`runRule`, the evaluator). Both reach production through `packages/configuration/src/publication.ts:304` and `:440` inside `planPublication`, which `apps/system-studio/src/app/tenants/[slug]/configuration/actions.ts:210`, `:265` and `:433` call from the Studio's configuration review, publish and rollback actions.
  - Tests: `packages/configuration/src/expression.test.ts` — 38/38, and the compiler's use of it in `packages/configuration/src/graph-snapshot.test.ts` — 55/55.
  - Evidence: `cd apps/web && npx jest --ci configuration/src/expression.test.ts` → `Tests: 38 passed, 38 total`. Whole package: `npx jest --ci packages/configuration` → `Test Suites: 15 passed, 15 total / Tests: 407 passed, 407 total`.
  - Mutation proof: 5 mutations, 5 caught, applied one at a time to `expression.ts` and restored byte-for-byte after each.
    (1) `return n < 0 ? -Math.round(-n) : Math.round(n)` → `return Math.round(n)` → `Tests: 1 failed, 37 passed` — `it is deterministic › rounds halves away from zero, stated rather than inherited`; restored → `38 passed`.
    (2) `"constructor",` → `"constructor-disabled-for-mutation",` in `FORBIDDEN_SEGMENTS` → `Tests: 1 failed, 37 passed` — `reflection is not reachable … › refuses the constructor walk that reaches Function`; restored → `38 passed`.
    (3) `return walk(n.otherwise)` → `return` in `dependencies` → `Tests: 1 failed, 37 passed` — `dependency analysis › looks inside every branch, including the one not taken`; restored → `38 passed`.
    (4) `maxDepth: 32,` → `maxDepth: 100000,` → `Tests: 1 failed, 37 passed` — `it is bounded in four dimensions › refuses nesting deeper than the limit, before the host stack is at risk`; restored → `38 passed`.
    (5) in `typeOf`'s `var` case, `if (!type) {` → `if (path === "never-a-real-path") {` → `Tests: 1 failed, 37 passed` — `cannot read a name nobody declared, even one that exists in the values`; restored → `38 passed`.

- [ ] **CFG-020-003** — Implement visibility, applicability, enablement, requirement, default, derivation, options, validation, invalidation, approval, lock, redaction and mapping rules.
  - Status: FAIL
  - Reason: imported from `Tenure_Declarative_Tenant_Configurator_and_Deployer_UX_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **CFG-020-004** — Generate client-safe presentation projection and server-authoritative evaluation from one graph snapshot.
  - Status: FAIL
  - Overturned on review: Both mutations reproduce (clientSlots audience filter → `filter(() => true)` = 1 failed/54, 'step 10 › ships the presentation rules and never the server-authoritative ones'; `dependsOn.find((path) => protectedIds.has(path))` → never-a-real-path = 1 failed/54, 'withholds a node whose rules READ a protected value'; restored, 55/55). The projection logic is genuine and the inference-leak rule is the right one. Refuted on check 3 and check 5. Neither half is generated for anything: a repo-wide grep finds no reference to presentationProjection or evaluateGraph outside packages/configuration/src/graph-snapshot.ts, its test, and the barrel re-exports at index.ts:142/144. The row's caller line claims 'the server-authoritative half is on the live publication path today' — it is not: publication.ts imports only compileGraph, graphSigningKeyFromEnv and snapshotBlockers (publication.ts:12-14) and the plan carries the snapshot, never an Evaluation. So the row admits the client half is unconsumed and overstates the server half, and §11 step 10's other clause ('the server remains authoritative and returns the evaluated state and trace') has no caller to return anything. Evidence that does not reproduce on a PASS row is the failure mode named in check 5.
  - Code: `packages/configuration/src/graph-snapshot.ts` — `RULE_SLOTS` (line 94) classifies every rule slot's audience, `presentationProjection` (line 910) produces the browser's view and `evaluateGraph` (line 700) produces the server's. Both take the SAME `GraphSnapshot` and the projection carries its `graphDigest`, which is what makes them one snapshot rather than two that agree until they do not. Two rules decide what crosses: only the presentation slots (`visibleWhen`, `enabledWhen`, `requiredWhen`) — never `deriveFrom`, `validateWhen` or `applicableWhen`, because a policy shipped as a hint lets the client compute what the server would decide and any difference then reads as a bug rather than as the server being authoritative; and no `confidential`/`secret` node, nor any node whose rules READ one. That second rule is the one worth having: `payroll.salary > 100000` shipped without the salary looks safe and is a bisection oracle that recovers the value it was meant to protect. Withheld nodes are LISTED with a reason, because a client that silently receives 40 of 60 nodes renders a form missing twenty fields and nothing says so.
  - Caller: `packages/configuration/src/index.ts:142` and `:144` export both from `@tenure/configuration`; the snapshot they project is the one `planPublication` compiles at `packages/configuration/src/publication.ts:440` and returns on `PublicationPlan.graph` (`:503`), which the Studio's actions at `apps/system-studio/src/app/tenants/[slug]/configuration/actions.ts:210` already receive. Honest limit: no browser component reads the projection yet — the generated Deployer UX is CFG-060 and is FAIL. What is closed here is the requirement's own sentence, which is about GENERATING the two projections from one snapshot, and the server-authoritative half is on the live publication path today.
  - Tests: `packages/configuration/src/graph-snapshot.test.ts`, `describe("step 10: two projections from one snapshot")` — 5 cases inside the file's 55/55.
  - Evidence: `cd apps/web && npx jest --ci configuration/src/graph-snapshot.test.ts` → `Tests: 55 passed, 55 total`.
  - Mutation proof: 2 mutations, 2 caught, one at a time, restored after each.
    (1) `const clientSlots = RULE_SLOT_NAMES.filter((slot) => RULE_SLOTS[slot].audience === "client-safe")` → `RULE_SLOT_NAMES.filter(() => true)` → `Tests: 1 failed, 54 passed` — `step 10 … › ships the presentation rules and never the server-authoritative ones`; restored → `55 passed`.
    (2) `const leak = node.dependsOn.find((path) => protectedIds.has(path))` → `…find((path) => path === "never.a.real.path")` → `Tests: 1 failed, 54 passed` — `step 10 … › withholds a node whose rules READ a protected value`; restored → `55 passed`.

- [ ] **CFG-020-005** — Prove hostile schema/rule content cannot execute arbitrary code, access secrets or escape its namespace.
  - Status: FAIL
  - Two of the three clauses are proven; the requirement says "prove" all three, so this is FAIL and not a partial PASS. **Arbitrary code**: `packages/configuration/src/expression.ts` never evaluates host code — a closed AST of eleven node kinds, a fixed function set, and `FORBIDDEN_SEGMENTS` refusing `constructor`/`__proto__`/`prototype`/`process`/`globalThis`/`require`/`module`/`eval`/`Function` at PARSE time so an attempt is visible in review rather than merely inert. `expression.test.ts`'s `reflection is not reachable, by any of the routes that work elsewhere` runs the real escapes, including `({}).constructor.constructor("return process")()`. Mutation-proven under CFG-020-002 above (mutations 2 and 5). **Namespace escape**: `compileGraph` reports `namespace-escape` for a declaration outside its own namespace and `cross-namespace-reference` for a rule reading outside its package's transitive closure; mutation-proven under CFG-030-001 (mutation 3).
  - What is NOT proven, and it is the schema surface rather than the expression surface. Every test above is over RULE content. Hostile SCHEMA content has no abuse suite: a manifest declaring a node id of `__proto__` or `constructor` (the compiler builds its `TypeEnv` with `Object.fromEntries`, which creates an own property and is believed safe, and "believed safe" is not the standard this asks for); a manifest declaring 100,000 nodes or a 10MB rule string, where there is NO bound on package or graph size to match the four bounds the expression language has per expression; a rule reading a `context.*` path the package never declared, which `typeOf` refuses today only because the caller happens to pass a narrow `contextTypes`; and a package claiming a namespace that is a prefix of another's (`payroll` vs `payrollx`) — the check is `startsWith(namespace + ".")`, which looks right and has no test.
  - **Access secrets** is the clause with the weakest evidence. What exists: an expression cannot read a name absent from the declared type environment even when the value IS present in the value environment (`cannot read a name nobody declared, even one that exists in the values`, mutation-proven), the value environment is a FLAT map so there is no property walk to subvert, and `planPublication` refuses a layer whose values look like a credential (`findSecretValues`, `publication.ts:372`). What is missing is a test that a hostile rule cannot reach a secret through the paths a real deployment would offer it — `process.env`, a resolved configuration value marked `sensitivity: "secret"`, or an external-check result — because those environments are assembled by callers that do not exist yet.
  - Unblock with: a `graph-abuse.test.ts` covering the four schema cases above plus package/graph size bounds added to `CompileInput`, and — for the secrets clause — CFG-110-001's threat model, which owns the abuse-test surface for schemas, expressions, drafts, files, approvals, preview and deployment handoff. Doing it here would produce the second half of a suite whose first half CFG-110-001 will write.

- [x] **CFG-030-001** — Compile package closure into a typed directed dependency graph and signed snapshot.
  - Status: PASS
  - Code: `packages/configuration/src/graph-snapshot.ts` — `compileGraph` (line 357) implements Bible §11's ten numbered steps, each marked in the code with the step it is, because a compiler that does nine of them reads exactly like one that does ten. It resolves package versions and namespaces, refuses a duplicate package key and a duplicate node identifier, refuses a package declaring an id outside its own namespace, type-checks every rule against a `TypeEnv` built from the whole closure, extracts static dependencies as typed edges carrying the slot that created them, and produces a `GraphSnapshot` with a per-package digest and one canonical `digest` over the whole graph. `signSnapshot` (line 273) and `verifySnapshot` (line 297) are the signature, following the convention `packages/provisioning/src/execute.ts:761` already sets for deployment manifests — `hmac-sha256`, a named `keyId`, a refusal to sign with an empty key ("a signature anyone can reproduce proves nothing"), and `resolveKey` supplied by the caller so this package holds no secret store. `graphSigningKeyFromEnv` (line 263) reads `CONFIG_GRAPH_SIGNING_KEY_ID` / `CONFIG_GRAPH_SIGNING_SECRET` and returns null when unconfigured, the same two-variable shape as `apps/system-studio/src/lib/deliver.ts:40`.
  - Caller: `packages/configuration/src/publication.ts:440` — `planPublication` compiles the closure it would publish on every call, passing `modules` (already `dependsOn` + `provides`) and `graphSigningKeyFromEnv()`, folds `snapshotBlockers(graph)` into `blockers` at `:445` and returns the snapshot at `:503`. That path is live: `apps/system-studio/src/app/tenants/[slug]/configuration/actions.ts:210`, `:265` and `:433` call `planPublication` with the real `MODULES` catalogue, so the compiler runs against production data on every Studio configuration review, publish and rollback.
  - Tests: `packages/configuration/src/graph-snapshot.test.ts` — 55/55, including `the real module catalogue › compiles, because a compiler that has only met fixtures has not met its data`.
  - Two things this row does NOT claim, stated because the digest's meaning depends on them. First, the signature is symmetric (HMAC); KMS asymmetric signing is the production upgrade and no key material is in this repository — unconfigured, a snapshot carries `unsigned` with the reason and never a signature. Second, `ModuleLike` reaching `planPublication` carries no `version`, so the live snapshot's digest detects a changed declaration and CANNOT detect the same declarations republished under a new version. Rather than digest an unversioned package as though it were versioned, the snapshot NAMES them in `unversionedPackages`, and a test asserts the real catalogue comes out that way through the publication path. Passing `version` through `ModuleLike` needs an edit to a Studio file this wave does not own.
  - Evidence: `cd apps/web && npx jest --ci configuration/src/graph-snapshot.test.ts` → `Tests: 55 passed, 55 total`. `npm run type-check` and `npm run studio:type-check` both clean.
  - Mutation proof: 4 mutations, 4 caught, one at a time, restored after each.
    (1) in `digestOf`, `packages: snapshot.packages,` → `packages: 0,` → `Tests: 3 failed, 52 passed` — `changes the digest when only the version changes`, `binds the outputs to the graph that produced them`, `refuses to re-evaluate across graph versions`; restored → `55 passed`.
    (2) in `verifySnapshot`, `if (recomputed !== snapshot.digest) {` → `if (recomputed === "never") {` → `Tests: 1 failed, 54 passed` — `step 9: the signature › detects content rewritten together with its digest`, which is the classic verifier bug: the signature is over the digest, so both are attacker-controlled unless the digest is re-derived from the content; restored → `55 passed`.
    (3) `if (target.namespace !== namespace && !visible.has(target.package)) {` → `if (target.namespace === "never-a-real-namespace") {` → `Tests: 1 failed, 54 passed` — `refuses a rule that reads outside its package closure`; restored → `55 passed`.
    (4) `unversionedPackages: resolved.filter((r) => r.version === null).map((r) => r.key),` → `unversionedPackages: [],` → `Tests: 2 failed, 53 passed` — `names a package whose manifest states no version rather than digesting it as if versioned` and `the real module catalogue › names every package as unversioned …`; restored → `55 passed`.

- [x] **CFG-030-002** — Detect cycles with minimal human-readable paths and block publication.
  - Status: PASS
  - Code: `packages/configuration/src/graph.ts:102` — `minimalCyclePaths`, breadth-first from each node back to itself, de-duplicated by member set and rotated to start at each cycle's lowest-sorting member. **Minimal** is the whole of this requirement and it is what was missing: two depth-first searches already existed in this package (`expressionCycles` in `expression.ts` and the cycle block inside `moduleGraphRejections`), both reported whichever cycle the traversal order closed first, and §11 step 6 asks for the shortest. Given `a → b → c → a` and also `a → c`, the depth-first answer sends an operator to look at `b`, which is not part of the smallest set of declarations that has to change. Both callers now delegate here, so the count of cycle detectors in this package went from two to one rather than to three: `packages/configuration/src/expression.ts:489` and `packages/configuration/src/rejections.ts:192`. The shared dependency resolution that both need is `satisfiersOf` / `dependencyAdjacency` (`rejections.ts:129`, `:142`), extracted for the same reason — a dependency that names a CAPABILITY rather than a module key is exactly what a second resolver gets wrong.
  - Caller: **blocking publication** is two paths, and both are live. A cycle in the package closure becomes a `dependency-cycle` rejection at `packages/configuration/src/rejections.ts:192`, reaches `allRejections` (`:305`) and sets `blocked` at `packages/configuration/src/publication.ts:450`. A cycle among a package's declared RULES becomes a `rule-cycle` problem at `packages/configuration/src/graph-snapshot.ts` (§11 step 6 block), is turned into a blocker by `snapshotBlockers` (`:963`) and pushed into `blockers` at `publication.ts:445`. `snapshotBlockers` deliberately filters out `package-cycle` and `unresolved-dependency`, which `allRejections` already reports, so an operator never sees one defect twice. Both arrive from `apps/system-studio/src/app/tenants/[slug]/configuration/actions.ts:210`/`:265`/`:433`.
  - §11 step 7 is honoured rather than ignored: a cycle is permitted ONLY when it is named in `fixedPointGroups`, which leaves a diff a reviewer can see, and declaring a fixed-point group for a cycle that no longer exists is itself a problem — an exemption nobody notices becoming live again.
  - Tests: `packages/configuration/src/graph.test.ts` — 21/21, and `packages/configuration/src/graph-snapshot.test.ts` `describe("step 6-8")` plus `describe("what a publication blocks on")` and `describe("planPublication compiles the graph it would publish")` inside 55/55.
  - Evidence: `cd apps/web && npx jest --ci configuration/src/graph` → `Tests: 76 passed, 76 total`. The pre-existing cycle tests in `rejections.test.ts` and `expression.test.ts` still pass unchanged after the refactor: `npx jest --ci packages/configuration` → `Tests: 407 passed, 407 total`.
  - Mutation proof: 4 mutations, 4 caught, one at a time, restored after each. The FIRST attempt at a minimality mutation — dropping the canonical rotation — was NOT caught, which found a real hole in my own test file: every cycle happened to be discovered from its lowest-sorting member in the cases I had written, so the rotation was untested. `graph.test.ts` gained `prints a cycle from its lowest-sorting member even when another member discovered it` (a graph where `b` sits on a shorter cycle, so the three-node cycle is first found from `c`), and the mutation then failed. Reported because a mutation that survives is the point of running them.
    (1) `for (const next of adjacency.get(tail) ?? []) {` → `… (adjacency.get(tail) ?? []).slice(0, 1)) {` → `Tests: 1 failed, 19 passed` — `minimal cycle paths › finds the SHORTEST cycle, not the first one a traversal closes`; restored → `20 passed`.
    (2) `const lowest = cycle.indexOf([...cycle].sort()[0])` → `const lowest = 0` → first run `75 passed, 75 total` (survived; test added), then `Tests: 1 failed, 75 passed` — `prints a cycle from its lowest-sorting member even when another member discovered it`; restored → `76 passed`.
    (3) `const alreadyReported = new Set(["package-cycle", "unresolved-dependency"])` → `…, "rule-cycle"])` → `Tests: 2 failed, 53 passed` — `what a publication blocks on › reports the problems only the graph compiler can find` and `planPublication compiles the graph it would publish › blocks a publication whose package closure declares a rule cycle`; restored → `55 passed`.
    (4) `if (path !== id || slot === "deriveFrom") readable.add(path)` → `if (path !== id) readable.add(path)` → `Tests: 3 failed, 52 passed` — `calls a deriveFrom that reads its own node a cycle` plus the two publication-blocking cases; restored → `55 passed`.

- [ ] **CFG-030-003** — Implement topological and affected-subgraph evaluation.
  - Status: FAIL
  - Overturned on review: Mutations are honest — I re-ran all three and they reproduce exactly (topologicalGroups `.every`→`.some` = 7 failed/69; affectedSubgraph `.filter((node) => reached.has(node))`→`.filter(() => true)` = 8 failed/68 including 'does not return what a change cannot reach' and 'does strictly less work than a full evaluation'; same line →`.reverse().filter(...)` = 2 failed/74; each restored byte-identical, 76/76 green). It fails check 3, reach, and the row's caller evidence does not reproduce. The row asserts graph-snapshot.ts ':700' (evaluateGraph) and ':723' (reevaluateGraph) 'Reach production through publication.ts:440'. They do not: publication.ts imports exactly compileGraph, graphSigningKeyFromEnv and snapshotBlockers (publication.ts:12-14) and calls only those. A repo-wide grep for evaluateGraph / reevaluateGraph / affectedSubgraph outside packages/configuration/src finds nothing — no file in apps/web, apps/system-studio, tools or any other package imports them; the only non-test references are the re-exports at index.ts:131,142,145. So the topological half genuinely reaches production (compileGraph uses topologicalGroups at graph-snapshot.ts:581), and the affected-subgraph EVALUATION half has no caller at all. Half a requirement plus a caller claim that is false is FAIL, not PASS.
  - Code: `packages/configuration/src/graph.ts:169` — `topologicalGroups`, Kahn by levels, each level sorted. GROUPS rather than a flat order because §11 step 8 says "evaluation groups" and because a flat order implies a sequence where none exists: two unrelated nodes must not appear ordered, or a later change that swaps them reads as a change in meaning. It also returns `unordered` and `cycles` rather than throwing, because groups covering 900 of 1,000 nodes with nothing said about the other 100 is a partial order that looks total. `packages/configuration/src/graph.ts:210` — `affectedSubgraph`, the changed nodes plus everything downstream, returned IN evaluation order; the order is as load-bearing as the set, since re-evaluating a dependent before its prerequisite reads a stale input and produces an answer a second pass would fix, which no assertion on the final values would notice. A changed path the graph does not read is ignored rather than treated as an unknown that invalidates everything — "re-evaluate the world when in doubt" is how an incremental evaluator quietly stops being incremental.
  - Caller: `packages/configuration/src/graph-snapshot.ts:357` (`compileGraph` stores `groups`/`unordered` on the snapshot), `:700` (`evaluateGraph` walks them), `:723` (`reevaluateGraph` computes the affected set and recomputes only that, carrying everything else over from the previous evaluation and marking those traces `reused` so a reader can see what was NOT recomputed). Reaches production through `publication.ts:440` → the Studio actions listed under CFG-030-001.
  - Tests: `packages/configuration/src/graph.test.ts` `describe("topological groups")` and `describe("affected subgraph")`; `packages/configuration/src/graph-snapshot.test.ts` `describe("affected-subgraph re-evaluation")`. 76/76 across the two files.
  - The test that carries the weight is `agrees with a full evaluation over the same inputs` paired with `does strictly less work than a full evaluation`. Either alone is worthless: correctness alone passes for an implementation that quietly recomputes everything, and a work-count alone passes for one that recomputes too little.
  - Evidence: `cd apps/web && npx jest --ci configuration/src/graph` → `Tests: 76 passed, 76 total`.
  - Mutation proof: 3 mutations, 3 caught, one at a time, restored after each.
    (1) in `topologicalGroups`, `.every((d) => placed.has(d))` → `.some((d) => placed.has(d))` → `Tests: 7 failed, 69 passed` — `puts prerequisites in an earlier group than what needs them`, `groups independent nodes together …`, `names what it could not order, and why`, `orders evaluation groups with prerequisites first`, `derives values in dependency order`, `computes each node's state …`, `agrees with a full evaluation over the same inputs`; restored → `76 passed`.
    (2) in `affectedSubgraph`, `.filter((node) => reached.has(node))` → `.filter(() => true)` → `Tests: 8 failed, 68 passed`, including `does not return what a change cannot reach` and `does strictly less work than a full evaluation`; restored → `76 passed`.
    (3) same line → `order.groups.flat().reverse().filter((node) => reached.has(node))` → `Tests: 2 failed, 74 passed` — `returns the changed node and everything downstream, in evaluation order` and `does not return what a change cannot reach`; restored → `76 passed`.

- [ ] **CFG-030-004** — Persist rule traces, inputs, outputs, graph version and evaluation errors.
  - Status: FAIL
  - Everything the requirement lists is now PRODUCED, and none of it is PERSISTED. `packages/configuration/src/graph-snapshot.ts` — `RuleTrace` carries the node, the slot, the expression source, the inputs it actually read WITH their values, its output, the evaluation steps it was charged, and `error: string | null`; `Evaluation` carries `graphDigest`, `compilerVersion`, `values`, `states`, every trace and a sorted `errors` list. An evaluation error is RECORDED rather than thrown, and a rule that could not be evaluated does not get to decide — defaulting a failed `validateWhen` to false would report a value invalid because a rule crashed, which is this codebase's central rule pointing at exactly this case. `records an evaluation error instead of throwing, and does not let a failed rule decide` covers it.
  - The gap is storage, and it is a schema gap. `apps/web/prisma/schema.prisma` has no table for an evaluation or a trace, and NO SCHEMA CHANGES were permitted in this wave — for a good reason: six unverified migrations from an earlier run had to be quarantined. The other candidate is the Studio's DynamoDB configuration store (`apps/system-studio/src/lib/config-store.ts`), which cannot be exercised from a local test run at all, so a claim of persistence there would be untestable by construction.
  - Shape it needs, so a schema wave can size it: one row per evaluation keyed by `(tenant, draftOrRevision, graphDigest)` holding `compilerVersion`, the canonical input map, `outputDigest`, and the sorted `errors`; and one row per trace holding `(evaluationId, node, slot)`, the expression source, the read inputs, the output, `steps` and `error`. Traces are append-only and are the input to CFG-040-005's "why am I seeing this" panel, so they need a retention rule alongside — an evaluation over 100k nodes writes 100k trace rows, and §16's budgets are the thing that decides whether they are stored per keystroke or per save.
  - Unblock with: a migration adding those two tables in a wave that owns `apps/web/prisma/schema.prisma`, then `evaluateGraph`'s result written through a store interface in `packages/configuration/src/store.ts` (which already defines `ConfigStore` and an in-memory implementation, so the interface has a shape to follow).

- [ ] **CFG-030-005** — Prove identical inputs and versions replay to canonical identical outputs.
  - Status: FAIL
  - Overturned on review: Both mutations reproduce (digestOf stableStringify→JSON.stringify = 1 failed/54, 'deterministic replay › does not depend on the order the inputs were declared in' — so the removed manual input sort really was masking it; digestOf `packages: snapshot.packages,`→`packages: 0,` = 3 failed/52 including 'binds the outputs to the graph that produced them' and 'refuses to re-evaluate across graph versions'; restored, 55/55). Refuted on two grounds. (1) Reach: the whole proof is about evaluateGraph, and nothing outside packages/configuration/src calls evaluateGraph or reevaluateGraph — publication.ts never evaluates a snapshot, it only compiles one. The property is proven over code no surface runs. (2) The 'and versions' half of the requirement's own sentence does not hold on the shipped path. apps/system-studio/.../configuration/actions.ts:227 (and :277, :445) rebuilds each module as `{key, dependsOn, provides, entitlement}`, dropping `version`, so every production package resolves to `version: null`. The test that carries the version half (`binds the outputs to the graph that produced them`) relies on the fixture helper withVersion('1.3.0'); with the live input, republishing the same declarations under a new version produces an IDENTICAL digest and therefore an identical outputDigest, which is exactly the replay the row says the digest prevents. Also worth naming: no test pins a golden digest literal, so 'canonical' is proven only self-relatively within one process.
  - Code: `packages/configuration/src/graph-snapshot.ts:700` — `evaluateGraph` returns an `Evaluation` carrying `graphDigest`, `compilerVersion` and `outputDigest`, where `outputDigest` is a sha256 over `{ graph: snapshot.digest, inputs, values, states }` serialised through this package's canonical serialiser (`stableStringify`, `merge.ts`). Both halves of the requirement's sentence are load-bearing and both are tested: identical INPUTS replay identically (five repeats, and again with the input map's keys in reverse order), and identical VERSIONS matter because the graph digest is inside the output digest — the same inputs against a republished package produce a different answer, which is what stops an approval bound to one graph from being replayed onto another. `reevaluateGraph` (`:723`) refuses outright to re-evaluate across graph versions, which is the one failure an incremental evaluator cannot detect after the fact.
  - Determinism is by construction, not by convention: the language has no clock, randomness or locale (CFG-020-002), the compiler sorts every list it emits, `graph.ts` derives its answers from the edge set rather than from insertion order, and key order is handled in ONE place. The redundant `.sort()` I first wrote over the input keys was removed for a specific reason recorded in the code: it left `stableStringify` untested on the one input whose key order a caller controls, so swapping it for `JSON.stringify` passed every test in the file. Removing it made that mutation fail.
  - Caller: `publication.ts:440` compiles the snapshot whose digest binds the replay; `packages/configuration/src/index.ts:142` and `:145` export `evaluateGraph` / `reevaluateGraph` from `@tenure/configuration`.
  - Tests: `packages/configuration/src/graph-snapshot.test.ts` `describe("deterministic replay")` — 4 cases — plus `recomputes nothing when nothing changed` and `refuses to re-evaluate across graph versions`, inside 55/55.
  - Evidence: `cd apps/web && npx jest --ci configuration/src/graph-snapshot.test.ts` → `Tests: 55 passed, 55 total`.
  - Mutation proof: 2 mutations, 2 caught, one at a time, restored after each.
    (1) `createHash("sha256").update(stableStringify(value))` → `…update(JSON.stringify(value))` → first run `55 passed` (survived — see above; the redundant input sort was masking it), then after removing that sort, `Tests: 1 failed, 54 passed` — `deterministic replay › does not depend on the order the inputs were declared in`; restored → `55 passed`.
    (2) in `digestOf`, `packages: snapshot.packages,` → `packages: 0,` → `Tests: 3 failed, 52 passed` — `binds the outputs to the graph that produced them` and `refuses to re-evaluate across graph versions` among them; restored → `55 passed`.

- [ ] **CFG-030-006** — Load-test million-value effective configuration and large graph behavior within approved budgets.
  - Status: FAIL
  - The blocker named first, because it is not the load test: **there are no approved budgets.** Bible §16 says "Define and test budgets for initial workspace load, field feedback, autosave acknowledgement, local subgraph evaluation, search, comparison and preview" and states no numbers, and no document in `docs/architecture/` carries them. A load test with a threshold I invent measures the threshold I invented; passing it would be the "hardcoded demo data" failure wearing a stopwatch.
  - What IS established, which is the half a load test would rest on: `affectedSubgraph` means a change re-evaluates its downstream cone rather than the graph (CFG-030-003, proven both correct and strictly cheaper than a full pass), the expression language is bounded per expression in four dimensions, and `compileGraph`/`evaluateGraph` allocate no per-node closures over the whole graph. What is NOT established: `compileGraph` has no bound on the NUMBER of packages, nodes or edges, `closureOf` does a `resolved.find` per dependency (quadratic in package count), and `affectedSubgraph` recomputes `topologicalGroups` over the whole graph on every call — which is correct and is exactly the wrong shape for the "local subgraph evaluation" budget §16 asks for.
  - Unblock with, in order: (1) an ADR or a section in `docs/architecture/` stating the seven §16 budgets as numbers, approved by a human; (2) a cached topological order on the snapshot so `affectedSubgraph` is O(affected) rather than O(graph); (3) `resolved` as a Map to kill the quadratic closure walk; (4) then a load test at 10^6 effective values asserting the approved numbers. Steps 2 and 3 are cheap and I did not do them, deliberately — optimising against a budget nobody has approved is how a performance claim becomes untestable.

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
  - Four of the section's six items now pass — CFG-030-001, -002, -003 and -005 — so "correct" has evidence: Bible §11's ten compilation steps are implemented and mutation-proven, cycles are minimal and block publication, evaluation is topologically ordered, incremental re-evaluation is proven to agree with a full pass AND to do strictly less work, and replay is canonical and bound to the graph digest.
  - The gate stays FAIL on the other two words. "Bounded" holds per expression (four dimensions, mutation-proven) and does NOT hold per graph: `compileGraph` accepts any number of packages, nodes and edges. "Scalable" is unproven and unprovable today, because CFG-030-006's budgets do not exist as approved numbers — see that row. CFG-030-004 also remains FAIL, so a compilation and evaluation cannot be reconstructed after the fact from anything durable.
  - A gate is the one place where "four of six" must not read as done. It flips when CFG-030-004 and CFG-030-006 have PASS rows of their own, not before.

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

## CFG-020-004 — both projections are generated from the live snapshot, and both are consumed

- [x] **CFG-020-004** — "Generate client-safe presentation projection and server-authoritative evaluation from one graph snapshot."
  - Status: PASS
  - What the overturn said, and what changed. The previous row was refuted on reach: "a repo-wide grep finds no reference to presentationProjection or evaluateGraph outside packages/configuration/src, its test, and the barrel re-exports", and the claim that the server half was live was false because `publication.ts` imported only `compileGraph`, `graphSigningKeyFromEnv` and `snapshotBlockers`. Both are now called from `planPublication` itself, and the reason nobody could call them before is the thing that was actually missing: **the live snapshot had no nodes**. `compileGraph` was being handed the module catalogue, whose manifests declare dependencies and capabilities and no configuration fields, so it compiled a graph of zero nodes — a digest, a signature, and nothing to project or evaluate.
  - Code: `packages/configuration/src/registry-graph.ts` — `registryGraphInput` (:135), `registryInputs` (:256), `changedNodes` (:274), `capabilityPath` (:94). It turns every `ConfigDefinition` into a `DeclaredNode` under its owner's namespace and derives rules from the flags that already decide the same things imperatively: `overridable: false` becomes `enabledWhen: "false"`, `requiresCapability` becomes `enabledWhen: "context.capability.<cap> == true"` (the same predicate `planPublication` refuses on, one source of truth in two places), `liveOnly` becomes `applicableWhen: "platform.payments.mode == \"live\""`. On the live registry that is 19 nodes, 3 capability rules and 1 applicability rule out of 23 keys; the other 4 have object or array defaults, and they are NAMED in `unrepresentable` with the reason rather than dropped.
  - Caller: `packages/configuration/src/publication.ts:499` compiles the registry closure, `:553` evaluates the current configuration, `:558` re-evaluates the proposal, `:564` projects the client-safe half, and `:614`–`:618` return `evaluation`, `presentation`, `nodesAffected` and `unrepresentableKeys` on the plan. `apps/system-studio/src/app/tenants/[slug]/configuration/actions.ts:223`, `:263` and `:421` call `planPublication` from the Studio's review, publish and rollback actions. The projection is then READ: `consequences.ts:31` (`consequenceLines`) turns it into review-panel lines, and `ConfigurationEditor.tsx:307` renders them under a "Consequences" heading.
  - Honest limits, stated so the next reader is not misled. The projection is displayed to an OPERATOR, not yet to a tenant browser rendering a schema-generated form — that surface is CFG-060 and is FAIL. And the live registry contains no `confidential` or `secret` key today, so the withholding rule is exercised on the live path only in the direction that returns "nothing withheld"; the positive case is proven on a fixture registry (`withholds a confidential registry key, and names it`).
  - Tests: `packages/configuration/src/registry-graph.test.ts` — 28/28, including the `one snapshot, two projections` block. `apps/system-studio/src/app/tenants/[slug]/configuration/consequences.test.ts` — 9/9, every plan built by `planPublication` over the live registry and the live catalogue.
  - Evidence: `cd apps/web && npx jest --ci configuration/src/registry-graph.test.ts` -> `Tests: 28 passed, 28 total`. `cd apps/web && npx jest --ci consequences` -> `Tests: 9 passed, 9 total`. `cd apps/web && npx jest --ci packages/configuration ../system-studio` -> `Test Suites: 102 passed, 102 total / Tests: 3315 passed, 3315 total`. `npm run type-check` and `npm run studio:type-check` both clean.
  - Mutation proof: 2 mutations, 2 caught, one at a time, restored byte-for-byte after each.
    (1) `presentation = presentationProjection(graph)` -> `presentation = null` (publication.ts:564) -> `Tests: 3 failed, 34 passed` — `projects the client-safe half of the same snapshot the server evaluated`, `keeps the server-authoritative applicability rule off the client`, `reports that nothing is withheld from the browser, rather than omitting the question`; restored -> `Tests: 37 passed, 37 total`.
    (2) `sensitivity: definition.sensitivity,` -> `sensitivity: "public",` -> `Tests: 2 failed, 26 passed` — `withholds a confidential registry key, and names it`, plus the pinned canonical digest, which moved; restored -> `Tests: 28 passed, 28 total`.

## CFG-030-003 — the affected-subgraph evaluator is the path production takes

- [x] **CFG-030-003** — "Implement topological and affected-subgraph evaluation."
  - Status: PASS
  - What the overturn said, and what changed. The previous row was refuted on reach and only on reach: "the topological half genuinely reaches production (compileGraph uses topologicalGroups at graph-snapshot.ts:581), and the affected-subgraph EVALUATION half has no caller at all". It has one now, and it is the natural one rather than a wrapper written to satisfy the check: a publication plan's whole job is to say what a change does, so `planPublication` evaluates the CURRENT configuration in full and then re-evaluates the PROPOSAL over only the nodes the diff reached and everything downstream of them. That is §16's "evaluate only affected subgraphs after a change", running where an operator's review runs.
  - Code: `packages/configuration/src/graph.ts:169` (`topologicalGroups`) and `:210` (`affectedSubgraph`) are unchanged and were already proven; what this wave adds is `packages/configuration/src/registry-graph.ts` — `registryGraphInput` (:135), `registryInputs` (:256), `changedNodes` (:274) — which gives the compiled graph its nodes, and the block at `packages/configuration/src/publication.ts:549`–`:573`: full evaluation of `before`, `reevaluateGraph` over the changed node set, `presentationProjection`, and `nodesAffected` computed by comparing the two evaluations rather than by re-reading the diff (a node whose STATE moves without its value moving is exactly the consequence a diff cannot show).
  - Caller: `packages/configuration/src/publication.ts:558` (`reevaluateGraph`) and `:553` (`evaluateGraph`), inside `planPublication`, which `apps/system-studio/src/app/tenants/[slug]/configuration/actions.ts:223`, `:263` and `:421` call for review, publish and rollback. The result is displayed: `consequences.ts:31` -> `ConfigurationEditor.tsx:307`.
  - The two tests that carry the weight, and neither is enough alone. `agrees with a full evaluation over the same inputs` compares the plan's incremental `outputDigest`, `values` and `states` against `evaluateGraph` over the same input map — correctness alone would also pass for an evaluator that quietly recomputes everything. `recomputes only what the change reached` counts traces: with a changed key that carries no rules, `traces.filter(t => !t.reused).length === 0` and the reused count is non-zero, so the evaluator is provably doing less work than a full pass.
  - Tests: `packages/configuration/src/registry-graph.test.ts` — 28/28; `apps/system-studio/src/app/tenants/[slug]/configuration/consequences.test.ts` — 9/9.
  - Evidence: `cd apps/web && npx jest --ci configuration/src/registry-graph.test.ts` -> `Tests: 28 passed, 28 total`. `cd apps/web && npx jest --ci consequences` -> `Tests: 9 passed, 9 total`. Whole configuration package plus the whole Studio suite: `cd apps/web && npx jest --ci packages/configuration ../system-studio` -> `Test Suites: 102 passed, 102 total / Tests: 3315 passed, 3315 total`.
  - Mutation proof: 1 mutation, caught in both files, restored byte-for-byte.
    (1) the `changed` argument to `reevaluateGraph` -> `[]` (publication.ts:562) -> `Tests: 3 failed, 25 passed` — `returns a server-authoritative evaluation bound to the snapshot it came from`, `agrees with a full evaluation over the same inputs`, `names the nodes a change moves, and no others`; and in the Studio file `Tests: 1 failed, 8 passed` — `names the field a change moves`; restored -> `Tests: 37 passed, 37 total`.

## CFG-030-005 — replay is proven on the path the Studio actually publishes through

- [x] **CFG-030-005** — "Prove identical inputs and versions replay to canonical identical outputs."
  - Status: PASS
  - What the overturn said, and what changed — all three grounds are addressed. (1) "nothing outside packages/configuration/src calls evaluateGraph": `planPublication` does now (`publication.ts:553`, `:558`), so the property is proven over code the Studio's review, publish and rollback actions run. (2) "the 'and versions' half does not hold on the shipped path — actions.ts rebuilds each module as `{key, dependsOn, provides, entitlement}`, dropping `version`": the three copied literals are replaced by one function, `apps/system-studio/src/app/tenants/[slug]/configuration/publication-modules.ts:23` (`publicationModules`), which carries `version`, and `carries every module, with its version` asserts every entry matches `MODULES`. (3) "no test pins a golden digest literal, so 'canonical' is proven only self-relatively within one process": `digests a fixed graph to a value pinned in this file, not to itself` asserts `sha256:485707561e6aed45b58ac60500b2c8f8fff9804b4b0d427d9e414dad0c129f19` for a fixed two-node registry and `sha256:161af37db129b04cc32154a4ac4376a86214b56fc213ea303f402b9deca73830` for its evaluation. Those are sha256 over this package's canonical serialisation — arithmetic, not a measurement of this machine.
  - Code: `packages/configuration/src/graph-snapshot.ts:700`/`:723` (`evaluateGraph`, `reevaluateGraph`, `outputDigest`) unchanged; `packages/configuration/src/registry-graph.ts:256` (`registryInputs`) builds the input map from declared nodes only, so two callers cannot disagree about which unrepresentable keys to include and produce different digests for the same configuration; `apps/system-studio/src/app/tenants/[slug]/configuration/publication-modules.ts:23`.
  - Caller: `actions.ts:223`, `:263`, `:421` -> `planPublication` -> `publication.ts:499`/`:553`/`:558`. The digest pair is shown to the operator who signs: `consequences.ts` emits the `bound-to` line — "An approval binds to this pair, so a proposal edited after approval no longer matches it" — rendered at `ConfigurationEditor.tsx:307`.
  - The one thing this row does NOT claim. The registry-derived package is unversioned, and the snapshot says so: `names no package as unversioned except the registry's own` asserts `unversionedPackages === ["platform"]`. A `ConfigRegistry` has no version to state and inventing one would put a false guarantee inside the digest. Every module package is versioned, and `gives a republished package a different digest, and the same values` proves the case the previous row could not: bumping `budgeting` to `2.0.0` changes the graph digest and the output digest while the evaluated values stay equal.
  - Tests: `packages/configuration/src/registry-graph.test.ts` `describe("identical inputs and versions replay to identical outputs")` — 4 cases inside 28/28; `consequences.test.ts` `describe("the module closure the Studio publishes")` — 2 cases inside 9/9.
  - Evidence: `cd apps/web && npx jest --ci configuration/src/registry-graph.test.ts` -> `Tests: 28 passed, 28 total`. `cd apps/web && npx jest --ci consequences` -> `Tests: 9 passed, 9 total`. Repository-wide: `cd apps/web && npx jest --ci` -> `Test Suites: 347 passed, 347 total / Tests: 8713 passed, 8713 total`.
  - Mutation proof: 2 mutations, 2 caught, one at a time, restored byte-for-byte after each.
    (1) `version: m.version,` -> `version: undefined,` (publication-modules.ts:26) -> `Tests: 1 failed, 8 passed` — `the module closure the Studio publishes > carries every module, with its version`; restored -> `Tests: 9 passed, 9 total`.
    (2) `sensitivity: definition.sensitivity,` -> `sensitivity: "public",` (registry-graph.ts) -> `Tests: 2 failed, 26 passed`, one of which is the pinned canonical digest moving; restored -> `Tests: 28 passed, 28 total`.
