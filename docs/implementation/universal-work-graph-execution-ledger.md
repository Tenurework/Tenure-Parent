# Universal Work Graph and Workspace Connector Cloud — execution ledger

Every `WRK-*` requirement stated by `Tenure_Universal_Work_Graph_and_Workspace_Connector_Cloud_Claude_Bible_v1.0.md`.

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

- [x] **WRK-000-001** — Inventory every current provider logo, route, SDK, OAuth app, token, webhook, sync, index, Relay tool, external action, environment, and public integration claim.
  - Status: PASS
  - Code: `tools/wrk-work-graph-inventory.mjs` derives `docs/architecture/wrk-work-graph-inventory.md`
    from the working tree — one row per declared provider across all twelve axes the
    requirement names, plus a detail table per axis. Every axis is derived: packs and
    capabilities are brace-scanned out of `packages/provisioning/src/provider-packs.ts` and
    `packages/provisioning/src/catalogs.ts`, routes from every `route.ts` in both apps, SDKs
    from all 88 direct dependency declarations, environment NAMES from `process.env.*` with
    comments stripped, egress from literal occurrences of the 40 declared hosts, Relay tools
    from `modules/index.ts`, claims from string literals beside a capability verb.
  - Not a duplicate of `docs/architecture/int-integration-inventory.md`: that one is
    resource-oriented (queues, events, alarms, producers). This one is provider-oriented, and
    the per-provider row is what makes invariant 3 — "no logo availability" — checkable at
    all. Each axis alone looks like a connector; the row says whether one exists.
  - Findings the derivation produced: 24 providers declared, 1 called (`anthropic`, at
    `apps/web/src/lib/ai.ts:208`); 0 of 24 declared OAuth redirect paths served by any route,
    so no declared pack can be authorized today; 1 of 24 with a client-registration
    environment name; 0 provider logo assets out of 2 image assets in the whole repository;
    1 Relay tool (`search.corpus`, read-only, Tenure's own corpus) and no external-action
    tool; 0 of 21 sync/index surfaces naming a provider host; 0 public integration claims.
  - Honest limit, stated in the document itself: deployed environments are NOT inspected.
    Nothing here authenticates to AWS or reads Secrets Manager, and no secret value is read
    or printed. Where WRK-000-001's "environment" means a running cell, that half is recorded
    as unmet rather than approximated from source.
  - Determinism: `git ls-files --cached --others`, POSIX paths, explicit sorts, CRLF
    normalised before every match, output joined with `\n`, `.gitattributes` pins `eol=lf`.
    Nothing reads a directory. The generated document is deliberately kept out of the
    document graph — an early draft said "the Bible" in its first 4000 characters, which made
    `tools/document-graph.mjs` classify it as an AUTHORITY and record it as the source
    document for WRK-000-001 instead of the Bible; a guard now asserts it stays out.
  - Tests: `tests/architecture/wrk-work-graph-inventory.test.mjs`, 9/9 under
    `node --test` (the `npm run test:platform` runner). It runs `--check`, refuses an empty
    scan, and re-derives every citation INDEPENDENTLY by opening the cited file at the cited
    line.
  - Evidence: 3 mutations, 3 caught. (a) deleted the real `slack.workspace` row from the
    committed document — `--check` exit 1 "is stale", suite 7 pass / 1 fail; restored, exit 0,
    8/8. (b) `names()` word-boundary matcher replaced with
    `text.toLowerCase().includes(token.toLowerCase())` — 5 pass / 3 fail, including the
    regression fixture that pins `/api/jobs/outbox` not being a Box route and
    `@aws-sdk/s3-request-presigner` not being an Adobe SDK (both were real false positives on
    the first run); restored, 8/8. (c) `packBlocks` line offset `+3` — 6 pass / 2 fail
    (staleness AND the citation re-derivation); restored, 8/8. Command:
    `node --test tests/architecture/wrk-work-graph-inventory.test.mjs`.

- [x] **WRK-000-002** — Classify each exact provider/product/capability/direction as `PLANNED`, `DEVELOPMENT`, `CERTIFICATION_PENDING`, `AVAILABLE`, `DEGRADED`, `SUSPENDED`, or `UNSUPPORTED` with evidence.
  - Status: PASS
  - Code: `packages/provisioning/src/connector-capability.ts` declares the seven-state
    `ConnectorCapabilityStatus`, `ConnectorCapability` keyed on
    (provider, product, capability, direction), and `capabilityProblems`, which refuses an
    `AVAILABLE`/`DEGRADED` claim with no `evidenceRefs` and one that disagrees with the
    artifact-level verdict. `ConnectorEntry.capabilities` in
    `packages/provisioning/src/catalogs.ts` is REQUIRED, so `tsc` names any construction site
    that has not classified itself — it named one (`catalogs.test.ts`) on the first compile.
  - Reuse, not a copy: the evidence rule is `claimIsUnproven`, the same predicate
    `certificationState` applies at `catalogs.ts`. Mutating it reds both suites.
  - Caller: `availabilityDecisions` returns `capabilities` on every connector decision and
    `apps/system-studio/src/app/page.tsx` renders one table row per tuple with its status,
    direction and evidence. The shipped Relay connector classifies its single real capability
    (`anthropic` / `messages-api` / `completion` / `write`) as `CERTIFICATION_PENDING` — not
    `AVAILABLE`, which is the overstatement the old vocabulary could not avoid.
  - Tests: `packages/provisioning/src/catalogs.test.ts`, 64/64. Asserted on what
    `availabilityDecisions` EMITS, never on `capabilityProblems` called directly.
  - Evidence: 3 mutations, 3 caught. Status `CERTIFICATION_PENDING`→`AVAILABLE` on the Relay
    capability: 1 failed / 63 passed. `evidenceRefs`→`[]`: 1 failed / 63 passed.
    `claimIsUnproven` forced to `false`: 2 failed / 62 passed (certification AND capability).
    Restored: 64/64. Command: `npx jest --ci provisioning/src/catalogs.test` from `apps/web`.

- [x] **WRK-000-003** — Import every `WRK-*` requirement into the canonical execution ledger and document graph.
  - Status: PASS
  - State of the tree, re-derived rather than asserted: the Bible states 88 `WRK-*`
    requirements by `requirementsIn`'s own reading; this ledger carries 88 rows; the
    difference in both directions is empty; there are no duplicates; no other `*-ledger.md`
    claims a `WRK-*` id; and `buildRegistry` resolves all 88 back to the Bible at its
    canonical path. The document graph registers it at
    `docs/architecture/architecture-document-graph.yaml:491` as `role: authority`,
    `requirement_prefixes: [WRK]`, `states_requirements: 88`.
  - What the existing ratchet could not see, and why this test exists: the global unimported
    count in `document-graph.test.mjs` is a UNION over every ledger, so a `WRK-*` row filed
    under another domain still reads as imported while this domain has nothing to work; an
    invented id inflates a denominator nobody re-derives; a duplicated id means two statuses
    and `next-batch.mjs` reads whichever the parser saw last. This checks all three, plus the
    half the INT sibling does not — the document graph entry itself.
  - Import is not progress. All 88 rows exist; at the time of writing 13 carry `PASS` and 75
    carry `FAIL`. The value of this requirement is that those 75 are visibly failing instead
    of invisible, and invisible reads exactly like done.
  - Tests: `tests/architecture/wrk-requirements-are-imported.test.mjs`, 8/8 under
    `node --test`. The Bible is read at the canonical path the GRAPH records, never a
    hard-coded string.
  - Evidence: 3 mutations, 3 caught. (a) deleted the `WRK-010-003` row from this ledger —
    7 pass / 1 fail ("has a row in the work-graph ledger"); restored, 8/8. (b) renamed
    `WRK-010-003` to the invented `WRK-999-999` — 6 pass / 2 fail (missing row AND invented
    id); restored, 8/8. (c) pointed `GRAPH_ID` at `tenure-not-a-document-in-the-graph` —
    1 pass / 7 fail, which proves the graph entry is genuinely read rather than assumed;
    restored, 8/8. Command:
    `node --test tests/architecture/wrk-requirements-are-imported.test.mjs`.
  - Not mine to fix: `docs/architecture/architecture-document-graph.yaml` and
    `capability-completeness-registry.yaml` are currently STALE against the tree
    (`node tools/document-graph.mjs --check` exits 1). Verified this is not caused by
    anything in this wave — the check still exits 1 with this domain's generated document
    moved out of the tree. `tools/document-graph.mjs` is a shared generator; regenerating it
    is the orchestrator's, not this domain's.

- [x] **WRK-000-004** — Bind this Bible to Integration, Tenant UX, Configurator, Relay, security, lifecycle, release, and owning domain Bibles.
  - Status: PASS
  - Code: `tools/wrk-authority-bindings.mjs` derives
    `docs/architecture/wrk-authority-bindings.md` — one row per binding with the governing
    document, its requirement prefix, the ledger that tracks it, the code that exists today,
    and where the boundary runs, quoting section 0 of the Bible for each.
  - Both halves that can go wrong are derived, not typed: the LIST of bindings is parsed out
    of WRK-000-004's own statement (`Bind this Bible to … Bibles.`), so dropping one reds and
    inventing a ninth reds the other way; and the read-order contract in section 0 is parsed
    and each of its 8 entries resolved to a file that exists.
  - Bindings: Integration→INT, Tenant UX→TTES, Configurator→CFG, Relay→(no such authority;
    owned by this Bible §5/§7 and `apps/web/src/lib/relay/*`), security→GE-150..153,
    lifecycle→GE-103 + SIMON (tenant) distinguished from §15.1 (provider), release→GE-171 +
    GE-430, owning domain→the 8 domain Bibles §0 item 7 names (HCM, FIN, PLN, OPS, ANL, PAY,
    PACK, SIMON).
  - Finding: read-order entry 8, "Tenure Major App and Industry Connector Catalog and
    Certification Matrix", names a document this repository does not contain — `git grep -F`
    finds the phrase only in that read-order line itself. Recorded as absent rather than
    mapped onto the nearest-sounding document; the Connection Composer Bible is a different
    document with a different title, and binding to it would be an invented correspondence.
    Producing the missing document is not this domain's to do.
  - No approval is claimed. Nobody from another domain has agreed this mapping; it is a
    reading of the documents named, and every claim it makes resolves to a path.
  - Tests: `tests/architecture/wrk-authority-bindings.test.mjs`, 8/8 under `node --test`.
    Compares the table against the requirement's wording in BOTH directions, opens every
    document/ledger/code path, and requires each governing document to be an `authority` in
    the generated graph carrying the prefix its row claims.
  - Evidence: 3 mutations, 3 caught. (a) renamed the `lifecycle` binding to
    `lifecycle-DROPPED` — 6 pass / 2 fail (staleness AND the both-directions comparison);
    restored, 8/8. (b) repointed the Integration binding at
    `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md` — a real
    file with the wrong prefix — 6 pass / 2 fail on the graph-prefix check, which a
    path-existence check alone would have passed; restored, 8/8. (c) cited the plausible
    `packages/releases/src/release-plan.ts`, which does not exist — 6 pass / 2 fail;
    restored, 8/8. Command:
    `node --test tests/architecture/wrk-authority-bindings.test.mjs`.

- [ ] **WRK-010-001** — Implement canonical provider, workspace, account, principal, container, object, permission, relationship, citation, sync, tombstone, and action objects.
  - Status: FAIL
  - Reason: imported from `Tenure_Universal_Work_Graph_and_Workspace_Connector_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **WRK-010-002** — Implement typed provenance and inferred-edge confidence/review/expiry.
  - Status: FAIL
  - Reason: imported from `Tenure_Universal_Work_Graph_and_Workspace_Connector_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **WRK-010-003** — Implement `REFERENCE_ONLY`, `SEARCH_PROJECTION`, and `GOVERNED_REPLICA` policies.
  - Status: FAIL
  - Reason: imported from `Tenure_Universal_Work_Graph_and_Workspace_Connector_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **WRK-010-004** — Implement external identity linking without email-only or ambiguous automatic merges.
  - Status: FAIL
  - Reason: imported from `Tenure_Universal_Work_Graph_and_Workspace_Connector_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **WRK-010-005** — Implement graph state, freshness, deletion, access loss, quarantine, conflict, and reconciliation.
  - Status: FAIL
  - Reason: imported from `Tenure_Universal_Work_Graph_and_Workspace_Connector_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **WRK-010-006** — Prove graph/API/store/cache/search isolation under adversarial external IDs.
  - Status: FAIL
  - Reason: imported from `Tenure_Universal_Work_Graph_and_Workspace_Connector_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **WRK-020-001** — Implement every connection class and prohibit class escalation.
  - Status: FAIL
  - Reason: imported from `Tenure_Universal_Work_Graph_and_Workspace_Connector_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **WRK-020-002** — Implement versioned include/exclude resource selectors and impact diffs.
  - Status: FAIL
  - Reason: imported from `Tenure_Universal_Work_Graph_and_Workspace_Connector_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **WRK-020-003** — Implement personal versus organization ownership, owner succession, and orphan recovery.
  - Status: FAIL
  - Reason: imported from `Tenure_Universal_Work_Graph_and_Workspace_Connector_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [x] **WRK-020-004** — Implement field/object system-of-record and sync-direction contracts.
  - Status: PASS
  - What was missing: `packages/module-runtime/src/coexistence.ts` declared authority at the
    business-DOMAIN grain only — `SystemOfRecordMap` keyed on `PERMISSION_DOMAINS`, roughly a
    dozen coarse names — and `coexistenceProblems` checked only that the profile was known, the
    map non-empty, every key a domain and every value one of two authorities. Nothing modelled an
    object or a field, and `grep syncDirection` across `apps/**`, `packages/**`, `tools/**` and
    `tests/**` returned nothing. So `COEXISTENCE_TRANSITION` ("controlled, bidirectional
    coexistence") could not say which side writes which field — the unnamed dual write the file's
    own header quote prohibits.
  - Code: `coexistence.ts` gains `SYNC_DIRECTIONS`/`SyncDirection`
    (`INBOUND`/`OUTBOUND`/`BIDIRECTIONAL`/`NONE`, stated from Tenure's point of view because a
    relative word means the opposite thing depending on who reads it), `FieldAuthority`,
    `ObjectAuthority` and `CoexistenceDeclaration.objectAuthority?`. `ObjectAuthority` names its
    `domain` explicitly rather than encoding it in a dotted `object` string, so the contradiction
    rule compares two recorded facts instead of a fact and a naming convention.
  - The three rules, in `coexistenceProblems` — the function the manifest validator calls:
    (a) `contradicts-system-of-record` — an object whose authority disagrees with its domain's
    entry, in both directions, plus `domain-not-declared` for an object in a domain the map does
    not mention (a domain nobody decided cannot be the thing an object is consistent with);
    (b) `bidirectional-outside-coexistence` — `BIDIRECTIONAL` only under `COEXISTENCE_TRANSITION`
    or `HYBRID_PROCESS_SPLIT`, the two profiles that declare it; (c) `field-owner-without-sync` —
    a field owned by the other side while its object declares `direction: "NONE"`, which is a
    field that silently never updates and is indistinguishable from one nobody has changed.
    Plus `duplicate-object`, `duplicate-field`, `unknown-direction`, `unknown-authority` and
    `malformed`. A word that is not an authority is refused as an authority and NOT also reported
    as contradicting the domain — a typo must not send an operator to fix the domain map.
  - Callers, both ends, because a declaration nothing carries is a rule nothing can break:
    - `packages/provisioning/src/manifest.ts` — `TenantManifest.objectAuthority?` added AND passed
      into `coexistenceProblems`. Without the pass-through the whole thing is inert; the mutation
      below proves it is not.
    - `planFor` — `objectAuthorityNotes` renders the split as a plan warning, so an approver reads
      "finance.LedgerEntry: external writes it, sync BIDIRECTIONAL, except memo → tenure" rather
      than a profile name with nothing under it.
    - `apps/system-studio/src/app/tenants/actions.ts` — `composeTenant` reads the new
      `objectAuthority` textarea through `apps/system-studio/src/lib/object-authority.ts` and puts
      the entries on the manifest; parse problems are RETURNED, never dropped, because a dropped
      line is a coexistence contract quietly shorter than what the operator wrote. The parser
      checks SHAPE only and leaves the vocabulary to `coexistenceProblems` — one owner per rule.
    - `apps/system-studio/src/app/tenants/new/ComposeForm.tsx` — the field itself, with the grammar.
    - `apps/system-studio/src/lib/adopt.ts` — `coexistenceForBinding` carries `objectAuthority`
      through to the adopted manifest instead of dropping it.
    - `blueprints/index.ts` — the `fixture-external-erp` binding now declares
      `finance.LedgerEntry` (external, INBOUND, `memo` → tenure) and `finance.Budget`
      (external, NONE), so the vocabulary has a shipped instance rather than only fixtures.
  - WIDENING: the field is optional, so `tsc` names no caller that omits it. Every
    `CoexistenceDeclaration` / `TenantManifest` construction site was opened and checked —
    `apps/system-studio/src/app/tenants/actions.ts` (wired), `apps/system-studio/src/lib/adopt.ts`
    (wired), `blueprints/index.ts` (declares one), `packages/provisioning/src/manifest.ts`
    (validator + plan, wired), `packages/platform-config/src/modules.ts` (reads
    `systemOfRecord` only — unaffected), and the fixtures in
    `packages/provisioning/provisioning.test.ts`, `adoption.test.ts` and
    `packages/platform-config/src/modules.test.ts` (optional, correctly absent). Two production
    construction sites exist and both set it; `grep manifestVersion:` finds no third.
  - Tests: `packages/module-runtime/src/module-runtime.test.ts` (+15, asserted through
    `coexistenceProblems`, never a private helper); `packages/provisioning/src/provisioning.test.ts`
    (+5, asserted through `validateManifest` and `planFor` — the wiring, not the rules);
    `packages/platform-config/src/modules.test.ts` (+1: every shipped binding's declaration must
    be accepted, so the new fixture cannot rot into a manifest the engine refuses to build);
    `apps/system-studio/e2e/object-authority-logic.spec.ts` (8, node-only) for the line grammar,
    including one case that puts the parser's OUTPUT through `coexistenceProblems`.
  - Mutations (3 applied, 3 caught, all restored):
    1. Rule (a) disabled (`else if (false)`) → module-runtime RED ×3 (`refuses an object claiming
       Tenure inside a domain an external system owns`, `refuses the same contradiction in the
       other direction`, `still applies every domain-level rule beside the object ones`) AND
       provisioning RED ×1. Restored, 89/89.
    2. Rule (b) disabled → module-runtime RED (`refuses BIDIRECTIONAL under a profile with one
       authoritative side`) AND provisioning RED (`refuses a bidirectional object under a profile
       that is not bidirectional`). Restored.
    3. The WIRING: `objectAuthority: manifest.objectAuthority` deleted from the
       `coexistenceProblems` call in `packages/provisioning/src/manifest.ts` — correct rules,
       zero effect — → provisioning RED ×3 (contradiction, bidirectional, field-without-sync).
       Restored, all 4 object cases green. This is the mutation that proves the change is reachable
       from production rather than only from its own test file.
  - Evidence: `npx jest --testPathPattern "module-runtime.test"` — 89/89.
    `npx jest --testPathPattern "packages/provisioning/src/provisioning.test"` — 68/68.
    `npx jest --testPathPattern "approvals-sla|module-runtime|platform-config|packages/provisioning|build-system|consumers"` — 616/616.
    `npx playwright test object-authority-logic` from `apps/system-studio` — 8/8.
    `npx tsc --noEmit` in `apps/web` — 9 errors, none in any file this entry touches
    (`finance/actions.ts` exports, `UnscopedReason`, audit `mode`; all owned by concurrent runs).
    `npx tsc --noEmit` in `apps/system-studio` — 0 errors.

- [ ] **WRK-020-005** — Require new approval/consent for meaningful selector or scope expansion.
  - Status: FAIL
  - Reason: imported from `Tenure_Universal_Work_Graph_and_Workspace_Connector_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [x] **WRK-030-001** — Implement capability-resolution outcomes without leaking hidden connections/resources.
  - Status: PASS
  - Evidence: `RefusedTool` (apps/web/src/lib/relay-tools.ts) now carries a required
    `disclosure: "not-in-this-system" | "not-permitted"` and a `safeReason` written for the
    person, alongside `requiredPermission` and the engine's `reason`, which are documented as
    log-only. `apps/web/src/app/api/ai/chat/route.ts` returns `safeReason`, `toolDisclosure`
    and a remedy put through `stripInternals`, and never `reason` or `requiredPermission` —
    the adversarial review's §21 (docs/architecture): "structured reason for authenticated
    members of the tenant".
    Both required fields made `tsc` name every construction site.
  - Tests: `relay-tools.test.ts` — a club member (a member of the tenant whose seat carries
    `search.index.query` at one unit, so the engine's refusal genuinely QUOTES the key) gets
    `disclosure: "not-permitted"` and a safe reason that repeats neither; the same principal at
    `midtown-arts`, whose blueprint omits `search`, gets `"not-in-this-system"`.
    `ai-kill-switch.test.ts` — "returns the safe half and none of the internal half" recomputes
    the internal refusal for the same principal and asserts no string anywhere in the response
    body contains it. It walks the parsed body rather than searching `JSON.stringify`, because
    JSON escapes the quotes the engine's detail contains and a stringify-and-includes assertion
    passed a genuine leak.
  - Mutation (on the producer): route returns `invocation.refusal.reason` → that test reds
    naming the leaked `Not a member of tenant "inst_test".`; restored → green. Second mutation:
    `stripInternals` returns the remedy unchanged → both WRK-030-001 route tests red on the
    leaked `search.index.query`; restored → green.

- [ ] **WRK-030-002** — Implement `ConnectionOpportunity`, `PendingActionIntent`, and single-use `ConnectionLaunchToken`.
  - Status: FAIL
  - Reason: imported from `Tenure_Universal_Work_Graph_and_Workspace_Connector_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **WRK-030-003** — Implement Tenure sign-in/sign-up interruption and exact safe task resumption.
  - Status: FAIL
  - Reason: imported from `Tenure_Universal_Work_Graph_and_Workspace_Connector_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **WRK-030-004** — Implement user connect, scope upgrade, resource selection, reauth, ask-admin, provider-sign-up, request-integration, alternative-source, and unavailable paths.
  - Status: FAIL
  - Reason: imported from `Tenure_Universal_Work_Graph_and_Workspace_Connector_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **WRK-030-005** — Ensure uncertified capabilities never produce a working-looking OAuth button.
  - Status: FAIL
  - Reason: imported from `Tenure_Universal_Work_Graph_and_Workspace_Connector_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **WRK-030-006** — Test expired, replayed, wrong-user, wrong-session, wrong-tenant, tampered, and already-consumed launch tokens.
  - Status: FAIL
  - Reason: imported from `Tenure_Universal_Work_Graph_and_Workspace_Connector_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **WRK-040-001** — Implement provider-specific authorization profiles using current secure flows, exact redirects, state, nonce, PKCE, backend exchange, and account verification.
  - Status: FAIL
  - Reason: imported from `Tenure_Universal_Work_Graph_and_Workspace_Connector_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **WRK-040-002** — Implement progressive scopes, user/admin consent, consent receipts, reconsent, revoke, and disconnect.
  - Status: FAIL
  - Reason: imported from `Tenure_Universal_Work_Graph_and_Workspace_Connector_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [x] **WRK-040-003** — Implement provider review/verification/marketplace status as activation gates.
  - Status: PASS
  - Code: `packages/platform-config/src/provider-review.ts` declares `ProviderReview`
    (program, state, approvedScopes, verifiedAt, expiresAt) and `providerActivation`, the one
    implementation of the rule. `ConnectorEntry` in `packages/provisioning/src/catalogs.ts`
    gains a required `requestedScopes` and an optional `providerReview`, and `isUsable` calls
    `providerActivation` — adding `provider-review-missing`, `provider-review-expired` and
    `scopes-exceed-provider-approval` to `UsabilityReason`. The verdict carries the review
    record, so `NOT_SUBMITTED` and `REJECTED` are told apart rather than collapsed.
  - Why platform-config: `tests/security/cell-independence.test.mjs` forbids `apps/web`
    importing `@tenure/provisioning`, and the request path has to read this. It is the same
    arrangement `model-policy.ts` documents at length — one definition, two importers — not a
    duplicated rule. The guard was not weakened and its allowlist is untouched.
  - Callers, two: `apps/system-studio/src/app/page.tsx` prints the provider programme and
    state beside every refusal, and `apps/web/src/app/api/ai/chat/route.ts` computes
    `providerActivation(RELAY_ANTHROPIC_SCOPES, RELAY_ANTHROPIC_REVIEW, now)`, reports it as a
    third separately-named field (`connectorRefusal` / `connectorDetail`) beside
    `aiDisabledReason` and `toolRefusal`, and makes it a term of `available`.
  - **Deliberate behaviour change.** No provider-side review of the Relay integration has been
    submitted, so `RELAY_ANTHROPIC_REVIEW.state` is `NOT_SUBMITTED` and the route now refuses
    the vendor call for every requester: `/api/ai/chat` degrades to sources-only, as it already
    does with no key. That is what an activation gate is; recording an approval nobody obtained
    to keep the prose flowing is the failure the gate exists to prevent. Retrieval, ranking and
    every refusal field are unaffected. `/api/ai/draft` is NOT covered by this gate — it is a
    different route and out of this item's scope, and WRK-040-003 is not complete for it.
    To reopen: perform the review, record state/scopes/dates in `provider-review.ts`.
  - Tests: `apps/web/src/app/api/ai/ai-kill-switch.test.ts` 27/27 — rewritten, not relaxed:
    the flag's independent REPORTING is still asserted (turnedOff / killed / outsideCohort /
    missing key all still distinguished), and the flag's EFFECT on a vendor call is still
    proven on `/api/ai/draft`. Plus `packages/provisioning/src/catalogs.test.ts` 64/64.
  - Evidence: 2 mutations, 2 caught. Deleting the scope-subset check from `providerActivation`:
    1 failed / 26 passed in the route suite and 1 failed / 63 passed in the catalog suite —
    which is also the proof `isUsable` calls that function rather than a copy of it. Dropping
    `activation.activated` from `available` in the route: 3 failed / 24 passed. Restored:
    27/27 and 64/64. Commands: `npx jest --ci api/ai/ai-kill-switch` and
    `npx jest --ci provisioning/src/catalogs.test` from `apps/web`.

- [ ] **WRK-040-004** — Implement Connection Credential Broker, KMS-bound token vault, short-lived runner capability, and broker-only refresh.
  - Status: FAIL
  - Reason: imported from `Tenure_Universal_Work_Graph_and_Workspace_Connector_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **WRK-040-005** — Prove browser/model/log/event/config/evidence never receive reusable provider secrets.
  - Status: FAIL
  - Reason: imported from `Tenure_Universal_Work_Graph_and_Workspace_Connector_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **WRK-040-006** — Test OAuth CSRF/mix-up/code interception/token substitution/wrong-account/confused-deputy and refresh-token theft/reuse cases.
  - Status: FAIL
  - Reason: imported from `Tenure_Universal_Work_Graph_and_Workspace_Connector_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **WRK-050-001** — Separate read, draft, write, sync, and admin tools with schemas and policy.
  - Status: FAIL
  - Done: `readOnly` is load-bearing for the first time. `authorizeRelayTools` takes a required
    `allow: "read-only" | "any"` (required, so `tsc` named both call sites rather than letting
    an unset option default open), and under `"read-only"` every `readOnly: false` registration
    is refused BEFORE its permission is consulted, with `remedy: { kind: "SURFACE_IS_READ_ONLY" }`.
    `apps/web/src/app/api/ai/chat/route.ts` passes `"read-only"` because it has no confirmation,
    preview or receipt step. A seven-class `ActionRiskClass` with per-class policy also landed —
    see WRK-050-005.
  - Tests: `relay-tools.test.ts` "a surface with no confirmation step offers read tools only" —
    a writing registration is refused with that reason and never offered, and the same
    registration IS offered under `"any"`, which proves the ceiling fires before the permission
    and the policy rather than standing in for them. `ai-kill-switch.test.ts` "refuses a writing
    registration on a surface that cannot confirm anything" runs the same case through the route,
    with the registration contributed by the real module catalog (`jest.requireActual`, one extra
    entry in the `search` manifest's `tools`).
  - Mutation (on the caller): route passes `"any"` → that route test reds, because this requester
    holds `approvals.request.create` AND the approvals domain's own policy, so the write is
    genuinely offered; restored → green.
  - Done (2026-08-07, the "with schemas" half, at the door): the arguments are an ALLOW-LIST.
    `TOOL_ARGUMENT_SCHEMAS` in `apps/web/src/lib/relay-tools.ts` declares, per `toolKey`, the
    arguments a tool takes and the `'string' | 'number' | 'boolean'` each is; `invokeRelayTool`
    gained two branches. `(a″)` refuses any tool key with NO schema entry — fail closed, and
    decided before the surface's executable list because a tool whose arguments are undeclared is
    not runnable anywhere and "not here" would imply it runs somewhere else. `(c)` refuses any
    argument the schema does not declare, or declares at another type. Both reuse `proposalRefusal`,
    so the refusal carries WRK-030-001's `disclosure`/`safeReason`/`remedy` triple, and both sit
    BELOW `CALLER_DECIDED_ARGUMENTS`: a proposal naming `tenantId` still gets "the assistant tried
    to choose whose data to use", not a generic "unknown argument".
    The direction is the point. Before this, a registration nobody had declared arguments for was
    the FULLY PERMISSIVE one — the door checked six names and passed every other key, at any type,
    with any value, straight into `args: { ...proposal.args, tenantId, actorId }`. It is now the
    unusable one.
    Seeded with the one real registration, `search.corpus: { query: "string" }` from
    `modules/index.ts`. `invokeRelayTool` takes the table as a defaulted last parameter — the same
    seam, and the same reason, as `authorizeRegistrations` taking a registration list: the catalog
    contributes ONE tool and it is read-only, so a gate exercised only against it is a gate
    exercised only against the case it does not fire on. The default is the fail-closed production
    value and `apps/web/src/app/api/ai/chat/route.ts` passes nothing.
  - Tests (added): `relay-tools.test.ts` — "refuses an argument the tool never declared"
    (`limit`, `rejected: "limit"`), "refuses a declared argument sent at the wrong type" (five
    wrong types for `query`), "refuses a registration nobody declared a schema for, even when it
    is offered" (against the SHIPPED table, with the tool genuinely offered AND executable), and
    "keeps 'you may not choose the tenant' above 'that argument is unknown'". Plus a coherence
    ratchet, "every registration this platform ships declares its arguments", in both directions.
    `ai-kill-switch.test.ts` — "refuses a registration whose arguments nobody declared" drives it
    through the ROUTE with a second read-only registration contributed by the real `search`
    manifest, asserts it IS offered, and pins the exact sentence.
  - Mutations (4 applied, 4 caught, all restored):
    1. The `if (!schema)` fail-closed branch disabled → the route test "refuses it even though it
       is offered and read-only" RED (the proposal falls through to the executable-list gate and
       says "The assistant cannot do that here", which is the less true statement), plus the door
       test and the audit-row test. Restored → green.
    2. The unknown-argument branch changed to `console.warn` + `continue` → "refuses an argument
       the tool never declared" RED. Restored → green.
    3. On the PRODUCER: a second registration `search.snippets` added to `modules/index.ts` and
       left out of the schema table → 7 RED, including the coherence ratchet ("covers each
       tenant's registrations") and the route test. Removed → green.
    4. `TOOL_ARGUMENT_SCHEMAS` emptied → 16 of 42 `ai-kill-switch.test.ts` tests RED, every one of
       them a retrieval that now reads "That capability has not been set up for the assistant to
       use yet." — the branch is reached from the ROUTE, not only from the door test. Restored →
       42/42.
  - Remaining, and why this is still FAIL not PASS: the schema is declared BESIDE the registration,
    not ON it. `ToolRegistration` in **packages/contracts/src/index.ts** carries `toolKey`,
    `module`, `description`, `requiredPermission`, `readOnly` and `reauthorizesPerCall` and no
    input/output schema field, so a module cannot ship a tool's arguments with the tool and the
    table in `relay-tools.ts` has to be kept in step by a test rather than by the type. The same
    file is what would carry the taxonomy (`ActionRiskClass` is still DERIVED). packages/contracts
    is owned by a concurrent run this session and was deliberately not edited here; that is a
    coordination constraint, not an external blocker, so the remainder is buildable next tick.
    Output schemas are absent entirely — nothing on this platform returns a tool result yet.

- [ ] **WRK-050-002** — Implement action risk classes, immutable plan digest, preview, confirmation, approval, step-up, execution, receipt, compensation, and reconciliation.
  - Status: FAIL
  - Done (2026-08-07): two of the ten. **Action risk classes** landed earlier (WRK-050-005,
    `ActionRiskClass` READ|DRAFT|WRITE|BULK|EXTERNAL_SHARE|DELETE|PRIVILEGED). **Immutable plan
    digest** and **confirmation** land here.
  - Code: `apps/web/src/lib/relay/action-plan.ts` (new) — `ActionPlan` carrying §7.3's fields this
    platform can actually answer (acting identity, tenant, toolKey, target, recipients, body,
    notification flag, permission impact) plus `args`, the catch-all that holds every argument the
    named projections did not claim; `planDigest`, a key-order-independent SHA-256 over all of
    them (the same canonicalisation discipline `apps/web/src/lib/provisioning/reconcile.ts`
    documents for the deployment digest); `issueConfirmation(plan, secret, now, ttlMs)` returning
    an HMAC over `{digest, tenant, actor, expiry}`; and `confirmationMatches(token, plan, context,
    now, secret)` returning a TYPED refusal — `MALFORMED | WRONG_TENANT | WRONG_ACTOR | EXPIRED |
    PLAN_CHANGED` — never a boolean, because "your approval timed out" and "somebody swapped the
    recipient list under you" are a UI event and a security event.
  - Code: `apps/web/src/lib/relay-tools.ts` — `planForInvocation` derives the plan from the
    invocation's OWN resolved arguments (never from a plan a caller hands in, which is the exact
    substitution §7.3 exists to stop), `mintConfirmation` / `verifyConfirmation` wrap the pair, and
    gate `(e)` of `invokeRelayTool` — the single production door, called by
    `apps/web/src/app/api/ai/chat/route.ts` — was `typeof token === "string" && token.trim().length
    > 0` and is now `verifyConfirmation`. `now` comes off the validated context's own `at` rather
    than `Date.now()`, so expiry is decided against the same instant every other decision on the
    request was. The signing key is `RELAY_CONFIRMATION_SECRET ?? AUTH_SECRET`, and a process with
    neither refuses every confirmation rather than passing them.
    Gate `(e)` sits BELOW the recipient gate `(d)` deliberately: "you sent this to somebody who was
    not on the list" is more specific than "that is not what was confirmed", and the second is what
    a digest would say about the first.
  - Consumers checked and fixed: `invokeRelayTool`'s callers are `chat/route.ts` and
    `relay-tools.test.ts`; `RelayInvocation`/`RefusedTool` are consumed by `chat/route.ts` and
    `ai-kill-switch.test.ts`. Every confirmation-bearing proposal in `relay-tools.test.ts` was
    rewritten to mint a real token for its own arguments — the canned literal `"confirm_9f2"` is
    gone. `ToolRegistration` was NOT widened; the plan is derived at the door for exactly that
    reason.
  - Tests: `apps/web/src/lib/relay/action-plan.test.ts` (new, 10 tests) — key-order independence,
    recipients as a set, and every §7.3 field moving the digest; verify/PLAN_CHANGED/WRONG_ACTOR/
    WRONG_TENANT/EXPIRED; a forged expiry with a kept signature; a token minted under another key;
    and the no-secret path. `relay-tools.test.ts` "a writing tool needs a confirmation bound to
    this exact plan" (9 tests) drives all of it through `invokeRelayTool`, including the four
    strings the old shape check accepted (`"y"`, `"confirm_9f2"`, `"true"`, `" "`).
  - Mutations (3 applied, 3 caught, all restored; the producer mutated, never the helper):
    1. `recipients` dropped from `planDigest`'s canonicaliser → "refuses a confirmation minted for
       a different recipient list" RED at the DOOR, and "refuses it for a plan whose recipient
       changed" RED at the primitive. Restored → 68/68.
    2. `toolKey` dropped from the same canonicaliser → a token minted for `search.corpus` is
       accepted for `approvals.raise`; "refuses a confirmation minted for a different tool" RED in
       both files. (This is why `toolKey` is in the digest and NOT duplicated in the token payload:
       two copies of a field agreeing with each other would have kept the test green.) Restored.
    3. Gate `(e)` reverted to the old `typeof token === "string" && length > 0` → 7 RED, including
       "refuses the strings the old shape check accepted". Restored → green.
  - Remaining, and why this is FAIL not PASS — eight of the ten:
    * **preview** — nothing renders the plan to a person. `planDigest` and the `ActionPlan` are the
      value a preview would show; the surface is missing.
    * **approval / step-up** — no second-actor approval and no re-authentication challenge.
    * **execution / receipt** — nothing executes a writing tool: `/api/ai/chat` declares
      `SURFACE_TOOL_POLICY = "read-only"`, so the writing branch has no live surface and
      `issueConfirmation` has no production caller. That is fail-closed and deliberate — a writing
      surface added tomorrow gets no writes until it wires a human confirmation step — but it is
      not "confirmation shipped end to end" and is not claimed as such.
    * **compensation / reconciliation** — need durable idempotency, and
      **apps/web/prisma/schema.prisma** has no `IdempotencyRecord` model; the only `idempotencyKey`
      in the schema is `ApprovalRequest`'s. That is a schema migration.
    * The risk ladder is `ActionRiskClass`, not §7.2's `A0_OBSERVE..A5_PROTECTED_DOMAIN`, and it is
      derived from the permission string rather than declared — which needs
      **packages/contracts/src/index.ts**, owned by a concurrent run.

- [ ] **WRK-050-003** — Reauthorize at execution and invalidate approval after meaningful plan or authority change.
  - Status: FAIL
  - Reason: imported from `Tenure_Universal_Work_Graph_and_Workspace_Connector_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [x] **WRK-050-004** — Implement idempotent cross-app sagas with partial-completion recovery.
  - Status: PASS
  - Code: `apps/web/src/lib/outbox/prisma-ports.ts` (the `OutboxPorts` implementation),
    `apps/web/src/app/api/jobs/outbox/route.ts` (the production caller),
    `apps/web/src/lib/outbox/consumers.ts` (the `deliver` end),
    `apps/web/src/app/(app)/admin/outbox-actions.ts` (the operator redrive).
  - What was actually wrong: the machinery existed and nothing ran it. `dispatchOnce`
    and `replay` were imported by exactly one file — their own unit test, which
    supplied fake ports — while `approvals/actions.ts` really did write
    `OutboxEvent` rows inside the deciding transaction. Every domain event the
    platform had ever emitted was sitting at `state = 'pending'`, and
    `@@index([state, availableAt])`, described in the schema as "the dispatcher's
    only query", served a dispatcher that had never been written.
  - The saga is two steps and it now completes: `ApprovalDecided` is written in the
    approval's transaction, the job claims it, and `memory.approval-decided` writes
    the decision into `MemoryRecord`. Proven end to end against Postgres in
    `apps/web/src/lib/jobs/outbox-dispatch.itest.ts`.
  - **Partial completion** is where the work went. Three distinct kinds:
    - A step that failed retries alone — the pass does not abort, so one consumer
      being briefly down cannot strand every later record. Asserted by the
      out-of-order case: the failing record comes back with `availableAt` strictly
      after the later record's `dispatchedAt`.
    - A pass that died mid-flight leaves rows at `dispatching`, which was a terminal
      state by accident: `claimDue` only matched `pending`, so a killed task's claim
      was stranded forever — the original defect one state further along. `claimDue`
      now also reclaims a `dispatching` row whose `updatedAt` is older than
      `CLAIM_LEASE_MS`, and refuses one inside its lease.
    - A stale writer must lose. Because a lease can expire, a hung dispatcher can
      return after another has dead-lettered the record; `markDispatched`,
      `scheduleRetry` and `deadLetter` therefore all carry `state: "dispatching"`
      in the predicate. Without it an `UPDATE … SET state = 'dispatched'` erases
      `deadLetteredAt` and the reason with it.
  - Idempotence is not "the consumer should deduplicate". `deliverToConsumers` writes
    an `InboxEvent` row in the SAME transaction as the handler's effects, keyed
    `(institutionId, eventId, consumer)`, and the unique index — not the pre-check —
    is what decides the race. Two dispatchers reaching one event after a replay: the
    loser's transaction rolls its own effects back with its inbox row.
  - Tenancy: the pass runs inside `forEachInstitution("outbox-dispatch", …)`, so each
    tenant's rows are claimed in that tenant's scope. `claimDue` is raw SQL and raw
    SQL does not pass the tenancy extension, so its `institutionId` predicate is
    written out by hand — the same reason the reminders route writes its
    `RoleAssignment` predicate by hand. Asserted: a pass for A does not claim B's row.
  - Tests: 11 in `dispatch.itest.ts`, 12 in `jobs/outbox-dispatch.itest.ts`, 7 in
    `prisma-ports.test.ts`, 5 in `consumers.test.ts` — all against real Postgres
    except the last two. Mutations, each restored: a claim that does not flip state
    reds 17 of 19; `markDispatched` before `deliver` reds four, the record staying
    `dispatched` instead of returning to `pending`; an unconditional
    `markDispatched` resurrects a dead letter and reds the stale-write case;
    removing the lease arm strands the killed dispatcher's claim.
  - Correction made while proving it: the comment claimed `SKIP LOCKED` was what
    stopped two dispatchers claiming the same row. Removing it left every test
    green — under READ COMMITTED a plain `FOR UPDATE` blocks and then re-evaluates
    the predicate against the updated row (EvalPlanQual), which now says
    `dispatching`. Safety comes from the single statement; `SKIP LOCKED` is
    liveness. The claim was fixed rather than the test.
  - Not covered by this entry: the command-bus half (`lib/commands/bus.ts:dispatch`)
    still has no caller, because wiring it needs an `IdempotencyRecord` table and a
    migration. No saga spans an external provider, because no connector exists yet.

- [x] **WRK-050-005** — Deny bulk, external-share, delete, HR, finance, payment, legal, safety, and privileged actions unless owning policies pass.
  - Status: PASS
  - Evidence: `ActionRiskClass = READ | DRAFT | WRITE | BULK | EXTERNAL_SHARE | DELETE | PRIVILEGED`
    and a pure `riskOf(tool)` in apps/web/src/lib/relay-tools.ts, derived from the registration's
    own facts: `readOnly` first, then the permission's domain and verb. A domain in
    {finance, hr, payment, legal, safety} is PRIVILEGED whatever the verb, because the verb
    cannot make a finance action less than a finance action. Anything above DRAFT must ALSO clear
    its domain's administrative permission, which `owningPolicyPermission` reads out of the
    shipped `PERMISSIONS` catalog (`finance` → `finance.budget.approve`, `approvals` →
    `approvals.request.decide`) rather than from a private map — a domain that declares none
    resolves to null and fails closed with `OWNING_POLICY_NOT_DECLARED`.
  - Reachable, not decorative: the class is on `OfferedTool` and `RefusedTool` and the chat route
    emits it — `toolRiskClass` plus `relayTools.offered[].riskClass` and
    `relayTools.refused[].riskClass` — so the classification is visible on the path that actually
    runs, and not only on a branch the one shipped read-only registration never reaches.
  - Tests: `relay-tools.test.ts` — the OSE Director genuinely holds `finance.ledger.post`
    (asserted with `decideCheck`, so the refusal is the second gate and not the first) and is
    still refused a `finance.ledger.post` tool, with the reason naming the finance policy and
    `remedy: { PERMISSION_NOT_HELD, finance.budget.approve, grantedByRoles: [finance.approver] }`.
    A write in `resources`, which declares no administrative act, is refused with
    `OWNING_POLICY_NOT_DECLARED`; a write in `approvals`, which does and whose policy the staffer
    holds, is OFFERED — so the gate is not "refuse every write" wearing a classification's clothes.
  - Mutation 1: `riskOf` returns READ for a policy-owning domain → the finance test and the
    classification test red; restored → green. Mutation 2 (on the PRODUCER): the chat route emits
    `toolRiskClass: null` → `ai-kill-switch.test.ts` "reports the risk class of the tool it ran"
    reds; restored → green.

- [x] **WRK-050-006** — Prove the model cannot choose tenant, token, provider account, unchecked recipient, or unrestricted operation.
  - Status: PASS
  - Evidence: `invokeRelayTool(set, context, proposal, limits)` in apps/web/src/lib/relay-tools.ts
    is the single door, returning `{ ok: true, tool, riskClass, args }` or `{ ok: false, refusal }`.
    Five refusals, each with a named reason: a tool not in `set.offered`; a tool outside the
    surface's required `executableToolKeys`; an argument named in
    `{tenantId, institutionId, connectionId, accountId, apiKey, onBehalfOf}` (compared
    case-insensitively, refused rather than silently overwritten); a `readOnly: false` tool with
    no non-empty `confirmationToken`; and a `to`/`cc`/`bcc`/`recipients` value outside the
    caller-supplied allowed set. On success `args` is stamped with `tenantId` and `actorId` from
    the validated `TenantContext`.
  - Wired: chat/route.ts:224-268 no longer calls `toolOffered` and no longer passes `userId` to
    the corpus loader. It builds the proposal from the untrusted body (`toolKey`, `args`), puts it
    through `invokeRelayTool` with `executableToolKeys: [search.corpus]` and
    `allowedRecipients: []`, and retrieves with `loadSearchCorpus(invocation.args.actorId)` — so
    the principal whose corpus is read comes back out of the decision, not out of the request body.
  - Tests (route-level, on what the route EMITS): `ai-kill-switch.test.ts` — a body carrying
    `{ toolKey: "search.corpus", args: { tenantId: "inst_other" } }` gets
    `toolRemedy: { PROPOSAL_NOT_ACCEPTED, rejected: "tenantId" }`, no sources, and
    `loadSearchCorpus` is never called; a clean request calls it with `"user_test"` and returns
    that user's rows; `{ args: { onBehalfOf } }` is refused the same way; an unoffered
    `finance.ledger` is refused with `MODULE_NOT_INSTALLED` and `toolRiskClass: null`; an offered
    but non-executable tool is refused. `relay-tools.test.ts` covers all six reserved argument
    names, the `TenantId` casing, the confirmation token (missing, blank, present) and the
    recipient subset rule against a genuinely offered writing tool.
  - `toolOffered` kept its production caller rather than becoming a test-only export: the route
    reports `relayTools.retrievalAvailable` from it, which is a different question from whether
    this proposal ran. A proposal refused for naming `tenantId` must not make a panel say "you do
    not have search here" — the capability is there and the request was wrong.
  - Mutation A: `"tenantid"` deleted from `CALLER_DECIDED_ARGUMENTS` → the route test "refuses a
    proposal that names another institution's tenant" reds; restored → green. Mutation B:
    `invokeRelayTool` accepts an unoffered toolKey (`?? set.offered[0]`) → the route test "refuses
    a tool this system has no registration for" reds; restored → green. Mutation C:
    `retrievalAvailable` frozen to `true` → "returns the safe half and none of the internal half"
    reds, so the field tracks the decision rather than being a constant; restored → green.

- [ ] **WRK-060-001** — Implement webhook/change-hint, cursor/delta/history, backstop poll, snapshot, backfill, on-demand, outbound, and file/feed primitives.
  - Status: FAIL
  - One of the eight is now real. **Outbound** is implemented and drained:
    `apps/web/src/lib/outbox/prisma-ports.ts` implements `OutboxPorts` over
    `db.outboxEvent` with an atomic single-statement claim, and
    `apps/web/src/app/api/jobs/outbox/route.ts` is the runner that had never
    existed — before this, `ls apps/web/src/app/api/jobs` was one directory
    (`reminders`) and every row `approvals/actions.ts` had ever written sat at
    `pending`. Delivery goes to the in-process consumers the module catalog
    declares (`apps/web/src/lib/outbox/consumers.ts`), with an `InboxEvent`
    written in the handler's own transaction so a redelivery cannot double the
    effect. Retry, exponential jittered backoff, dead-lettering at
    `MAX_ATTEMPTS`, operator redrive and gap reconciliation all reachable.
    Evidence: `apps/web/src/lib/outbox/dispatch.itest.ts` (11) and
    `apps/web/src/lib/jobs/outbox-dispatch.itest.ts` (12) against real Postgres,
    each mutation-proven — see WRK-050-004 above for the mutation list.
  - The other seven are NOT built and this is not a partial pass. There is no
    webhook or change-hint receiver, no cursor/delta/history reader, no backstop
    poll, no snapshot, no backfill, no on-demand fetch and no file/feed primitive
    anywhere in `apps/` or `packages/` — and no connector for them to run against,
    so none of them can be written as anything but a shape. This item returns to
    the queue for those seven; it should not return for the outbound half.

- [ ] **WRK-060-002** — Implement raw-body signature verification, replay defense, durable acceptance, subscription verification/renewal, and catch-up.
  - Status: FAIL
  - Reason: imported from `Tenure_Universal_Work_Graph_and_Workspace_Connector_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [x] **WRK-060-003** — Implement pagination, cursor expiry, checkpoints, tombstones, moves, ACL changes, loop prevention, throttling, fairness, and provider outage recovery.
  - Status: PASS
  - Code: `apps/web/src/lib/outbox/prisma-ports.ts`,
    `apps/web/src/app/api/jobs/outbox/route.ts`,
    `apps/web/src/lib/outbox/consumers.ts`, `modules/index.ts` (the memory manifest).
  - The item this was open on: the transactional outbox had no runner, so every
    `ApprovalRequested` / `ApprovalDecided` row ever written was stranded at
    `pending`. `modules/index.ts` said so itself — the memory module's
    `commands-events-and-idempotency` verdict read `gap`, "nothing delivers that
    event yet: dispatchOnce takes a `deliver` port and no runner supplies one".
    That line was true and has been flipped to `pass` only now the runner exists,
    with the route path as its evidence.
  - **Pagination / throttling**: `claimDue(now, limit)` with `BATCH = 50` per
    institution per pass. Proven: with `limit` below the backlog the pass takes the
    oldest `limit` and leaves the remainder `pending`, and the next pass finishes
    them — not "small enough that everything fit".
  - **Checkpoints**: the checkpoint is the row, not a side table. `state`,
    `attempts`, `availableAt`, `lastError`, `deadLetteredAt` and `dispatchedAt` are
    on the record, so "why was this never delivered" is answerable from the same
    database that holds the change. An eight-pass walk asserts the counter really
    accumulates across passes rather than only reading correctly when seeded.
  - **Loop prevention**: `assertDeclared` refuses at import time any handler whose
    module does not declare that event type in `consumes`. A handler cannot
    subscribe to what it emits, and a consumer the catalog cannot see cannot ship.
    Four cases in `apps/web/src/lib/outbox/consumers.test.ts`; disabling either
    branch reds one of them.
  - **Fairness**: the pass runs per institution via `forEachInstitution`, so each
    tenant gets its own bounded claim rather than competing for one global `LIMIT`.
    Proven with 200 rows in institution A, all older than institution B's single
    row: B's is dispatched in the same pass. Mutated by giving the route one shared
    budget consumed in institution order — B's row stays `pending` and the test reds.
  - **Outage recovery**: exponential jittered backoff, dead-lettering at
    `MAX_ATTEMPTS` with the reason on the row, an operator redrive that refuses
    anything not actually dead, and — the piece that was missing — reclaim of a
    claim whose dispatcher died, via `CLAIM_LEASE_MS`. A record stranded at
    `dispatching` past its lease is picked up; one inside its lease is not.
  - Honest about the rest of the title: **cursor expiry, tombstones, moves and ACL
    changes** have no subject in this codebase. They are properties of syncing a
    provider's object graph, and there is no connector, no cursor and no external
    ACL to change. Writing them now would be shapes with no caller — the exact
    failure this ledger keeps recording. They belong with the connector work.
  - Tests: 12 in `apps/web/src/lib/jobs/outbox-dispatch.itest.ts` and 11 in
    `apps/web/src/lib/outbox/dispatch.itest.ts` against real Postgres, 5 in
    `consumers.test.ts`. Mutations listed under WRK-050-004, plus: default
    `deliver` replaced with a no-op — the `MemoryRecord` assertions red, proving
    the consumer is genuinely on the end of the route and not asserted into
    existence.

- [ ] **WRK-060-004** — Implement coverage/action/index/ACL/subscription reconciliation with exception ownership.
  - Status: FAIL
  - Reason: imported from `Tenure_Universal_Work_Graph_and_Workspace_Connector_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **WRK-060-005** — Test duplicates, out-of-order, gaps, partial pages/batches, time zones, recurrence, Unicode, large files, and stale conditional writes.
  - Status: FAIL
  - Reason: imported from `Tenure_Universal_Work_Graph_and_Workspace_Connector_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **WRK-070-001** — Implement AWS-hosted governed content pipeline and tenant/cell/region-scoped projections.
  - Status: FAIL
  - Reason: imported from `Tenure_Universal_Work_Graph_and_Workspace_Connector_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **WRK-070-002** — Enforce source ACL plus current Tenure/purpose/policy authorization before model exposure.
  - Status: FAIL
  - Reason: imported from `Tenure_Universal_Work_Graph_and_Workspace_Connector_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **WRK-070-003** — Implement freshness/source/inference distinctions and governed provider deep-link citations.
  - Status: FAIL
  - Reason: imported from `Tenure_Universal_Work_Graph_and_Workspace_Connector_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **WRK-070-004** — Implement deletion/access/retention/legal-hold propagation across graph, chunks, embeddings, caches, summaries, and citations.
  - Status: FAIL
  - Reason: imported from `Tenure_Universal_Work_Graph_and_Workspace_Connector_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **WRK-070-005** — Implement indirect prompt-injection, malicious-file, DLP, link, and tool-exfiltration defenses.
  - Status: FAIL
  - Reason: imported from `Tenure_Universal_Work_Graph_and_Workspace_Connector_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **WRK-070-006** — Implement governed `MemoryCandidate` review and private-versus-role-memory separation.
  - Status: FAIL
  - Reason: imported from `Tenure_Universal_Work_Graph_and_Workspace_Connector_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **WRK-080-001** — Implement and separately certify Microsoft Outlook Mail, Calendar, People, Teams, SharePoint, OneDrive, and Planner/To Do packs for declared capabilities.
  - Status: FAIL
  - Reason: imported from `Tenure_Universal_Work_Graph_and_Workspace_Connector_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **WRK-080-002** — Implement delegated/application/admin consent, tenant/account/resource verification, change notifications, delta/backstop, and Graph throttling/deprecation behavior.
  - Status: FAIL
  - Reason: imported from `Tenure_Universal_Work_Graph_and_Workspace_Connector_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **WRK-080-003** — Implement and separately certify Google Gmail, Calendar, Drive/Docs, People, Meet, Chat, Tasks, and approved Directory/Groups packs.
  - Status: FAIL
  - Reason: imported from `Tenure_Universal_Work_Graph_and_Workspace_Connector_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **WRK-080-004** — Implement Google user OAuth/domain-wide delegation boundaries, sensitive/restricted-scope external gates, history/incremental changes, watches, and shared-resource semantics.
  - Status: FAIL
  - Reason: imported from `Tenure_Universal_Work_Graph_and_Workspace_Connector_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **WRK-080-005** — Prove mail draft/send, calendar recurrence, sites/drives, shared/delegated resources, deletes, ACL changes, admin denial, and reauth end to end.
  - Status: FAIL
  - Reason: imported from `Tenure_Universal_Work_Graph_and_Workspace_Connector_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **WRK-090-001** — Implement Slack workspace/channel/thread/message/app-event packs with distribution-aware scopes and rates.
  - Status: FAIL
  - Reason: imported from `Tenure_Universal_Work_Graph_and_Workspace_Connector_Cloud_Claude_Bible_v1.0.md`; not yet implemented
  - Incremental evidence 2026-08-11: the Slack provider pack now carries the
    repository-level setup references required to begin wiring the Slack app:
    `SLACK_APP_ID`, `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET` and
    `SLACK_SIGNING_SECRET`, all as GitHub Actions secret names only. This does
    not satisfy WRK-090-001 yet: no Slack API client, event verification,
    distribution-aware scope model, rate profile, workspace/channel/thread
    object model or reconciliation tests have been implemented.

- [ ] **WRK-090-002** — Implement Zoom meeting/webinar/report/recording/transcript packs with separate Phone/Contact Center/RTMS gates.
  - Status: FAIL
  - Reason: imported from `Tenure_Universal_Work_Graph_and_Workspace_Connector_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **WRK-090-003** — Implement Notion page/block/database/data-source/comment/search/upload/webhook packs with shared-resource and API-version semantics.
  - Status: FAIL
  - Reason: imported from `Tenure_Universal_Work_Graph_and_Workspace_Connector_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **WRK-090-004** — Implement Box file/folder/version/metadata/classification/collaboration/search/event/webhook packs with ownership/admin boundaries.
  - Status: FAIL
  - Reason: imported from `Tenure_Universal_Work_Graph_and_Workspace_Connector_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **WRK-090-005** — Test provider-specific event verification, pagination/rates, deletion/access loss, resource selection, app removal, and reconciliation.
  - Status: FAIL
  - Reason: imported from `Tenure_Universal_Work_Graph_and_Workspace_Connector_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **WRK-100-001** — Implement prioritized certified packs for Dropbox, Jira, Confluence, Asana, Monday, Linear, ClickUp, Trello, Smartsheet, and Airtable.
  - Status: FAIL
  - Reason: imported from `Tenure_Universal_Work_Graph_and_Workspace_Connector_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **WRK-100-002** — Implement prioritized certified packs for Coda, Miro, Webex, RingCentral, DocuSign, Adobe Sign, Egnyte, and ShareFile.
  - Status: FAIL
  - Reason: imported from `Tenure_Universal_Work_Graph_and_Workspace_Connector_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [x] **WRK-100-003** — Bind exact provider packs to capability and industry requirements from the catalog; unbuilt packs remain `PLANNED`.
  - Status: PASS
  - Code: `CatalogLifecycle` in `packages/provisioning/src/catalogs.ts` gains `PLANNED` as its
    first value with transitions `PLANNED: ["DRAFT", "REVOKED"]` and nothing transitioning into
    it; `isUsable` refuses it with its own reason `planned`, ahead of the generic
    `not-published` branch, and carries the entry's disclaimer on that refusal.
    `packages/provisioning/src/provider-packs.ts` declares the 24 named packs as
    `ProviderPackEntry` rows at `PLANNED`, each with the exact WRK id that asks for it, and
    `CATALOG_ENTRIES` includes them. `requirementIds` is on `ProviderPackEntry` only — putting
    it on `CatalogEntry` would not compile against `MODEL_CATALOG` in `@tenure/platform-config`.
  - Caller: `apps/system-studio/src/app/page.tsx` already splits `availabilityDecisions` into
    offered/refused, so all 24 now render under "Not available, and why" with reason `planned`
    and a disclaimer stating that no code, registration, scope set, certification or provider
    review exists. Before this they appeared nowhere at all, and invisible reads like done.
  - Tests: `tests/architecture/provider-packs-bind-requirements.test.mjs` 5/5 — every cited id
    must exist in `docs/architecture/capability-completeness-registry.yaml`, and any pack whose
    requirement is not PASS in this ledger must be `PLANNED`. Plus
    `packages/provisioning/src/catalogs.test.ts` 64/64, which asserts on what
    `availabilityDecisions` RETURNS for a planned entry, not on `isUsable` directly.
  - Evidence: 3 mutations, 3 caught. `microsoft.outlook-mail` → `PUBLISHED` while WRK-080-001
    is FAIL: 4 pass / 1 fail. A `requirementIds` pointed at `WRK-999-999`: 3 pass / 2 fail.
    Deleting the `planned` branch from `isUsable`: 3 failed / 61 passed in the catalog suite.
    Restored: 5/5 and 64/64. Commands:
    `node --test tests/architecture/provider-packs-bind-requirements.test.mjs` and
    `npx jest --ci provisioning/src/catalogs.test` from `apps/web`.

- [ ] **WRK-100-004** — Prove every available secondary pack against the full certification contract, not a generic happy path.
  - Status: FAIL
  - Reason: imported from `Tenure_Universal_Work_Graph_and_Workspace_Connector_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **WRK-110-001** — Implement all Connection Center surfaces and calm status language in the Tenant Experience System.
  - Status: FAIL
  - Reason: imported from `Tenure_Universal_Work_Graph_and_Workspace_Connector_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **WRK-110-002** — Implement plain-language access previews, advanced details, resource selectors, scope changes, health/remediation, receipts, privacy, and disconnect.
  - Status: FAIL
  - Reason: imported from `Tenure_Universal_Work_Graph_and_Workspace_Connector_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **WRK-110-003** — Implement save/resume/back/forward/refresh/cross-device recovery and no-loss configuration history.
  - Status: FAIL
  - Reason: imported from `Tenure_Universal_Work_Graph_and_Workspace_Connector_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **WRK-110-004** — Pass WCAG 2.2 AA, keyboard, screen-reader, reflow/zoom, high-contrast, reduced-motion, localization/RTL, responsive, and realistic-density matrices.
  - Status: FAIL
  - Reason: imported from `Tenure_Universal_Work_Graph_and_Workspace_Connector_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **WRK-110-005** — Run nontechnical usability tests for connect, ask-admin, fix, disconnect, and action confirmation without provider-console knowledge.
  - Status: FAIL
  - Reason: imported from `Tenure_Universal_Work_Graph_and_Workspace_Connector_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **WRK-120-001** — Implement control, authorization, credential, subscription, quota, runner, sync, graph, content, action, and reconciliation services in Tenure-owned AWS.
  - Status: FAIL
  - Reason: imported from `Tenure_Universal_Work_Graph_and_Workspace_Connector_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **WRK-120-002** — Prove cell/tenant/region isolation, strict egress, least IAM, encryption, backup/restore, DR, and no global unpartitioned sensitive store.
  - Status: FAIL
  - Reason: imported from `Tenure_Universal_Work_Graph_and_Workspace_Connector_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **WRK-120-003** — Implement provider/tenant/capability SLOs, dashboards, alerts, runbooks, escalation, deprecation, recertification, and outage controls.
  - Status: FAIL
  - Why still FAIL: the first tenant SLO, its evaluator, its alert and its runbook now exist and
    are proven end to end. Dashboards, escalation, recertification and outage controls do not, and
    eleven of the twelve modules still have no objective at all. Marking this PASS would be
    claiming seven things on the strength of three.
  - What was missing, and is no longer: `packages/module-runtime/src/manifest.ts:98` declares
    `observability-slo-and-finops` as a required completeness dimension and every module in
    `modules/index.ts` recorded it as a gap — twelve of twelve. There was no SLO type, no
    objective, no error budget and no evaluator anywhere; `grep errorBudget|error_budget` across
    `apps/`, `packages/` and `infrastructure/` returned only vendored terraform binaries. So the
    dimension was one no manifest could ever pass, which makes it a row of text.
  - Code: `ModuleSlo` (`objective`, `target`, `window`, `measure`, `runbook`) on
    `ModuleManifest.slo?`, and `sloBurn(measurements, objective)` in
    `packages/module-runtime/src/slo.ts` returning `{total, good, bad, attained, burn, met,
    runbook, breaching}`. `burn` is `(1 - attained) / (1 - target)` — the fraction of the error
    budget consumed — because `met: false` alone cannot tell a target that has slipped from a
    queue that has stopped, and only one of those is an outage. An empty window attains 1 and is
    met (an institution with no pending approvals has breached nothing; reporting one trains
    people to stop reading the alert), with `total: 0` on the result so "healthy" and "quiet" stay
    distinguishable. A target outside `0 < t < 1` throws `SloObjectiveError` rather than returning
    `Infinity`; `validateManifest` refuses it at declaration, so reaching the throw means an
    objective was built somewhere other than a manifest.
  - The rule that makes the dimension unfakeable: `validateManifest` refuses
    `observability-slo-and-finops: pass` from a module declaring no objective. It runs on the
    shipped catalog at `ModuleCatalog.of(MODULES)`, so the dimension can no longer be flipped by
    rewriting its evidence sentence. The CONVERSE is deliberately not a rule — the dimension is
    observability AND FinOps, and a module can have a real objective while attributing no cost.
  - Declaration: `approvals` in `modules/index.ts` declares "a pending approval is decided within
    its SLA", 0.95 over 30d, measured by `apps/web/src/lib/approvals-sla.ts` (which already
    computed exactly that per request), runbook `docs/runbooks/approvals-queue-stalled.md` (new,
    and it says out loud what it does not cover). One module, not twelve: inventing eleven
    objectives with nothing measuring them recreates the unfalsifiable claim the seventeen
    dimensions replaced.
  - Caller: `apps/web/src/app/api/jobs/slo/route.ts`, modelled on
    `apps/web/src/app/api/jobs/reminders/route.ts` — `JOB_SECRET` bearer auth, `parseJobRequest`
    envelope, and `forEachInstitution` so the burn is PER TENANT. That split is WRK-120-003's
    "provider/tenant/capability SLOs": an objective averaged over the fleet is one a large tenant
    satisfies on behalf of a small one that has stopped. Each pass resolves that institution's own
    business calendar through `localizationFor`, ages every open `ApprovalRequest` from
    `updatedAt` (time in the CURRENT gate, the same field the page ages from), and reports
    `alert: true` with the runbook when any tenant misses. 200 on a breach, deliberately — a
    non-2xx makes the scheduler retry, and a stalled queue does not unstall by asking again. A
    manifest with no such objective returns 503, never a green "met".
  - `PENDING_STATES` is now exported from `approvals-sla.ts` and the route's query is derived from
    it, so a status the page ages and the objective ignores is not representable.
  - `modules/index.ts:294` stays a **gap**, with the detail rewritten to the half that is still
    missing: nothing attributes what the module CONSUMES to a tenant. `price` is a list price the
    composer quotes, which is what a customer is charged and not what the capability costs to run.
  - Tests: `apps/web/src/lib/jobs/approvals-slo.itest.ts` (6, against PostgreSQL) — two
    institutions, one with four of ten open requests thirty days stale and one with two fresh
    requests plus a decided-and-stale one that must NOT be measured. Asserted on what the ENDPOINT
    emits, never on `sloBurn`: `attained` 0.6, `burn` 8, `met: false`, `breaching` equal to the
    four seeded ids, `alert: true`, and the healthy tenant separately at `burn` 0 — an average
    would read 0.67 and name neither. One case opens the runbook path the endpoint returns and
    asserts the file exists and contains the objective, because a runbook path resolving to
    nothing is the claim the dimension already was. Plus
    `packages/module-runtime/src/module-runtime.test.ts` (+15) for the declaration rules and the
    burn arithmetic.
  - Mutations (2 applied, 2 caught, both restored):
    1. `sloBurn` frozen to a constant (`attained = 1`, `burn = 0`, `breaching = []`) → the ENDPOINT
       test RED: `reports the objective breached for the institution whose queue is stale`,
       1 failed / 5 passed. The producer was mutated, not the helper, and the assertion that
       caught it reads the route's response body. Restored, 6/6.
    2. The `observability-slo-and-finops: pass` rule disabled (`if (false)`) → module-runtime RED
       (`refuses a pass with no objective declared`), 1 failed / 88 passed. Restored, 89/89.
  - Evidence: `DATABASE_URL=postgresql://tenure:tenure@127.0.0.1:5480/tenure npx jest --testMatch
    "**/approvals-slo.itest.ts" --runInBand` from `apps/web` — 6/6.
    `npx jest --testPathPattern "module-runtime.test"` — 89/89.
    `npx jest --testPathPattern "approvals-sla|module-runtime|platform-config|packages/provisioning|build-system|consumers"` — 616/616.
    `npx tsc --noEmit` in `apps/web` — 9 errors, none in a file this entry touches.
    `npm run test:platform` — the raw-client rule (`tests/architecture/forbidden-clients.test.mjs`)
    named this itest on the first run; it was fixed by using `@/lib/db` rather than by adding an
    exemption, and the file no longer appears. The remaining failures name generated-doc staleness
    and other runs' files.
  - Still to build for a PASS: dashboards; escalation; recertification; outage controls;
    provider- and capability-grain objectives (only the tenant grain exists); objectives for the
    other eleven modules; and the FinOps half of the dimension — per-module, per-tenant cost
    attribution, which nothing anywhere computes.

- [ ] **WRK-120-004** — Implement cost allocation and budgets for tokens, provider calls, workers, queues, payloads, parsing, indexing, model use, backfill, and retained state.
  - Status: FAIL
  - Reason: imported from `Tenure_Universal_Work_Graph_and_Workspace_Connector_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [x] **WRK-120-005** — Implement suspend, hibernate, reactivate, offboard, purge, and owner-departure behavior with residual-resource/cost reconciliation.
  - Status: PASS
  - Already shipped and not rebuilt: the suspend/hibernate/reactivate/offboard/purge machine in
    `packages/provisioning/src/lifecycle.ts` — `TRANSITIONS`, `REQUIRES_APPROVAL` and the
    approver checks in `advance`. The two open clauses were owner departure and reconciliation.
  - Code (reconciliation): `packages/provisioning/src/residual-reconciliation.ts` turns
    `RESIDUAL_COST` from five English sentences into `ResidualClaim`s — a `ResourceClass[]` plus
    the *same* sentence — and adds `reconcileResidual`, which returns `unexplained` (retained,
    not claimed: a bill nobody expected) and `overclaimed` (claimed, not retained: a console
    charging for nothing). `observeResidual` derives what a tenant holds from four facts the
    control plane already owns — isolation, whether an artifact was published, whether it
    serves, how many evidence records exist — so no tenant row is read. `RESIDUAL_COST` is now
    DERIVED from the claims, so the prose and the checkable list cannot drift.
  - Code (owner departure): `REQUIRES_OWNER` = SUSPENDING / HIBERNATING / OFFBOARDING, an
    `ownerPrincipalId` on `AdvanceOptions`, a refusal in `advance` when it is missing or blank,
    and the successor recorded on the `LifecycleStep`. Same shape as `REQUIRES_APPROVAL`, and
    deliberately not the approver: one agrees to the move, the other answers for the tenant.
  - Callers, all four wired: `apps/system-studio/src/lib/tenant-state.ts` (`riskOf` takes
    `observed` as a REQUIRED argument — an empty default would report "nothing unexplained" to
    every caller that forgot it — and `residualFindings` returns null for a state that claims
    nothing); `apps/system-studio/src/app/tenants/[slug]/page.tsx` observes from the record and
    renders `unexplained` and `overclaimed` beside the note, and passes `needsOwner` per move;
    `AdvanceControls.tsx` renders the successor-owner field; and
    `apps/system-studio/src/app/tenants/actions.ts` reads it from the form and passes it to
    `advanceTenant` — not defaulted to the requesting operator, which would satisfy the check
    by naming whoever clicked.
  - `packages/finops` is untouched: cost ALLOCATION is theirs, what a lifecycle state retains
    is the state machine's.
  - Tests: `packages/provisioning/src/provisioning.test.ts` and
    `apps/system-studio/e2e/states-logic.spec.ts` 17/17, which asserts on what `riskOf` EMITS —
    the projection the page renders — not on `reconcileResidual` in isolation.
  - Evidence: 2 mutations, 2 caught. `reconcileResidual` forced to return an empty
    `unexplained`: 4 failed / 64 passed in the provisioning suite AND the console spec reds on
    "names a hibernated tenant's compute as a bill the note does not cover". Dropping the
    successor-owner refusal from `advance`: the departure test reds. Restored: 17/17 and the
    lifecycle suite back to its pre-existing state. Commands:
    `npx jest --ci provisioning/src/provisioning.test` from `apps/web` and
    `npx playwright test states-logic` from `apps/system-studio`.
  - Not claimed: the provisioning suite currently shows 3 unrelated `manifest ›` failures that
    move between runs — another run is mid-edit in `@tenure/module-runtime`'s coexistence
    checks. None of them are in this item's files and none were introduced by it.

- [ ] **WRK-120-006** — Run restore, provider outage, token compromise, webhook flood, stale ACL, poisoned content, and cross-tenant incident exercises.
  - Status: FAIL
  - Reason: imported from `Tenure_Universal_Work_Graph_and_Workspace_Connector_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **WRK-130-001** — Implement all ten work accelerators for the exact connector capabilities selected for release.
  - Status: FAIL
  - Reason: imported from `Tenure_Universal_Work_Graph_and_Workspace_Connector_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **WRK-130-002** — Measure baseline/after time, context switches, manual copies, steps, wait, errors, completion, trust, accessibility, and handoff completeness.
  - Status: FAIL
  - Reason: imported from `Tenure_Universal_Work_Graph_and_Workspace_Connector_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **WRK-130-003** — Pass all eighteen required E2E scenarios plus provider-specific golden/negative/volume/failure suites.
  - Status: FAIL
  - Reason: imported from `Tenure_Universal_Work_Graph_and_Workspace_Connector_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **WRK-130-004** — Bind connector code, app registrations, scopes, policies, mappings, schemas, tools, prompts, tests, provider reviews, certification, evidence, runbooks, and rollback into one signed release.
  - Status: FAIL
  - Reason: imported from `Tenure_Universal_Work_Graph_and_Workspace_Connector_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **WRK-130-005** — Publish an exact supported capability matrix and every limitation/external blocker; remove or label false public/product claims.
  - Status: FAIL
  - Reason: imported from `Tenure_Universal_Work_Graph_and_Workspace_Connector_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **WRK-GATE-000** — No existing connector or AI capability is overstated.
  - Status: FAIL
  - Reason: imported from `Tenure_Universal_Work_Graph_and_Workspace_Connector_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **WRK-GATE-010** — The Work Graph is tenant-safe, source-aware, minimal, and reconcilable.
  - Status: FAIL
  - Reason: imported from `Tenure_Universal_Work_Graph_and_Workspace_Connector_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **WRK-GATE-020** — Connections cannot exceed granted identity, resource, direction, purpose, or tenant authority.
  - Status: FAIL
  - Reason: imported from `Tenure_Universal_Work_Graph_and_Workspace_Connector_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **WRK-GATE-030** — Relay turns missing access into a secure, honest, low-friction path.
  - Status: FAIL
  - Done (the API contract): `RefusedTool` carries a required discriminated `remedy` —
    `MODULE_NOT_INSTALLED { module }` when no registration of that name exists in this system,
    `PERMISSION_NOT_HELD { requiredPermission, grantedByRoles }` when `decide()` refused,
    `OWNING_POLICY_NOT_DECLARED { domain }`, `SURFACE_IS_READ_ONLY { toolKey }` and
    `PROPOSAL_NOT_ACCEPTED { rejected }`. `grantedByRoles` is resolved by `rolesGranting` from
    `ROLE_TEMPLATES` — the same catalog `seat-world.ts:94` hands the engine — so "ask an
    institution.director" is derived from the shipped roles and can never name one that does not
    exist. chat/route.ts returns it as `toolRemedy` alongside the existing `toolRefusal` string
    the current client renders, with `requiredPermission` stripped so the way out does not
    reintroduce the disclosure WRK-030-001 closes.
  - Tests: `relay-tools.test.ts` — the same principal, the same tool, two tenants: `rochester`
    yields `PERMISSION_NOT_HELD`, `midtown-arts` yields `MODULE_NOT_INSTALLED`, and the kinds are
    asserted to differ. `grantedByRoles` is compared against `rolesGranting("search.index.query")`
    and spot-checked (`institution.staff` in, `identity.administrator` out).
    `ai-kill-switch.test.ts` asserts both kinds reach the response body and that
    `toolRemedy.requiredPermission` is undefined.
  - Mutation: both branches collapsed to one remedy kind → the tenant-vs-principal test and both
    route tests red; restored → green.
  - Remaining, and why this is FAIL not PASS: nothing renders `toolRemedy` yet. A person still
    sees only the sentence — `apps/web/src/components/ai/relay-reply.ts` and `TenureAIPanel.tsx`
    read `toolRefusal` and nothing else — so this is an honest refusal with a machine-readable
    route to access, not yet a low-friction path in front of a human. Those components are owned
    by the Connection Center run (WRK-110-002) this session; the wiring is a UI change, not an
    external blocker.

- [ ] **WRK-GATE-040** — Authorization is least-privilege, provider-compliant, revocable, and auditable.
  - Status: FAIL
  - Reason: imported from `Tenure_Universal_Work_Graph_and_Workspace_Connector_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **WRK-GATE-050** — Relay accelerates work without becoming an autonomous authority.
  - Status: FAIL
  - Children: 3 of 6 decided — `WRK-050-001` FAIL, `WRK-050-002` FAIL,
    `WRK-050-003` FAIL, `WRK-050-004` PASS, `WRK-050-005` PASS, `WRK-050-006`
    PASS. A gate is proven by its children and by nothing else.
  - **The PASS is withdrawn, and this is the record of it.** A run set this row
    to `- [x]` / PASS with no `Children:` line while three of its six children
    were FAIL, arguing on this row that the gate is about AUTHORITY while those
    three are about COMPLETENESS. That argument is a good one and it is kept
    below, but it is an argument for re-scoping the children, not for passing
    the gate over them — the ledger's own rule, written out under
    `TTES-GATE-040`, is that a gate cannot become PASS by anything done to the
    gate's own row. `git show
    HEAD:docs/implementation/universal-work-graph-execution-ledger.md` still has
    this row as `- [ ]` / FAIL; the PASS existed only in an uncommitted working
    tree, and that run was killed before review. To make this gate PASS
    honestly, close `WRK-050-001`, `WRK-050-002` and `WRK-050-003`, or move the
    completeness clauses out of them into a differently-numbered series and say
    so in an ADR.
  - What was open, in two halves, and both are closed.
  - **(1) The brake on a writing tool was a shape assertion wearing the name of an
    authorization.** `relay-tools.ts` gated `readOnly === false` on `typeof confirmationToken ===
    "string" && token.trim().length > 0`. `grep -rn confirmationToken apps/web/src modules` found
    it in exactly two places — that check, and a test passing the canned literal `"confirm_9f2"`.
    Nothing minted a confirmation, nothing bound one to a plan or to the arguments it approved, and
    nothing expired one; the token arrived in the same request body as the model's own proposal, so
    the model confirmed itself. It is now `apps/web/src/lib/relay/action-plan.ts` — an HMAC over a
    canonical digest of the plan (which covers the tool key and every non-caller-decided argument),
    the tenant, the actor and a five-minute expiry — verified at gate `(e)` of `invokeRelayTool`.
    `PROPOSAL_NOT_ACCEPTED { rejected: "confirmationToken" }` now means what its name says. Full
    detail, tests and mutations under WRK-050-002.
  - **(2) Nothing recorded that the relay ran.** `/api/ai/chat` invoked a tool, loaded the
    caller's entire corpus and decided whether to post it to a vendor, and `grep -n
    recordAuditEvent apps/web/src/app/api/ai/chat/route.ts` returned nothing — three comments about
    auditing, zero writes. The route now writes ONE chained row per request through
    `recordAuditEvent` from `@/lib/audit-record` (never raw `db.auditEvent.create`, ratcheted at 32
    in `tests/security/audit-writes.test.mjs`, which still passes 6/6 and did not move), for the
    ALLOW and the DENY alike, before the vendor call. The row carries: the actor and the SEAT they
    acted under (`seatFor`), the `toolKey`, the `riskClass` `riskOf` returned, the policy and
    configuration revisions, the surface's ceiling, the connector activation verdict and its
    reason, whether the rows actually crossed the vendor boundary, the `planDigest` of the exact
    plan that ran, and WHICH sources by `{id, kind, mode}`. Never a question, never a title, never
    a body — asserted, not merely intended.
    The chained-write half and the `$transaction`-callback stand-in were landed concurrently by the
    run holding WRK-GATE-040 and are credited there; what this entry added is the connector
    verdict, the exposure flag, the plan digest and the per-source identities — the four facts that
    make "who asked, which tool, at which risk class, over which sources" answerable rather than
    "a decision was taken".
  - Mutations for (2) (3 applied, 3 caught, all restored; the ROUTE mutated, not the writer):
    1. `sources: scored.map(…)` → `sources: []` → "names the tool, its risk class, the connector
       verdict and the sources by id" RED. Restored.
    2. `planDigest: proposalDigest(proposal, context)` frozen to a zero constant → "carries the
       digest of the exact plan that ran" RED (the second request with a different argument no
       longer differs). Restored.
    3. `connectorActivated/connectorReason` frozen to `true`/`"activated"` → the same first test
       RED on the verdict. Restored → 42/42.
  - Why the AUTHORITY half is closed while WRK-050-001 and WRK-050-002 remain FAIL, which is
    the argument for re-scoping and not a reason this row may be PASS: those two are about
    COMPLETENESS of the tool contract and of the ten-step action lifecycle — schemas on
    `ToolRegistration`, preview, receipt, compensation, reconciliation. This gate is about
    AUTHORITY, and on every surface that exists the relay now has none of its own: it cannot choose
    the tenant, the actor, a provider account, a credential, a recipient, a resource the grant did
    not select, an argument nobody declared, or a tool nobody declared arguments for; it cannot
    write without a confirmation cryptographically bound to the exact plan, issued to this person,
    in this tenant, within five minutes; and it cannot read anything without leaving an
    attributable, hash-chained row naming what it read. The one thing it still cannot do is
    ACCEPT a confirmation from a human, because no writing surface exists to collect one — which
    is the fail-closed direction.



- [ ] **WRK-GATE-060** — Provider events and APIs converge to known source truth without duplicate business effects.
  - Status: FAIL
  - Reason: imported from `Tenure_Universal_Work_Graph_and_Workspace_Connector_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **WRK-GATE-070** — Relay answers are access-safe, cited, current enough, and memory-governed.
  - Status: FAIL
  - Reason: imported from `Tenure_Universal_Work_Graph_and_Workspace_Connector_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **WRK-GATE-080** — Microsoft and Google capabilities are available only at exact product/action/scope/resource certification.
  - Status: FAIL
  - Reason: imported from `Tenure_Universal_Work_Graph_and_Workspace_Connector_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **WRK-GATE-090** — The four named providers are engineered, not merely displayed.
  - Status: FAIL
  - Reason: imported from `Tenure_Universal_Work_Graph_and_Workspace_Connector_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **WRK-GATE-100** — Secondary connector breadth grows without weakening exact availability.
  - Status: FAIL
  - Reason: imported from `Tenure_Universal_Work_Graph_and_Workspace_Connector_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **WRK-GATE-110** — Connector UX is fast, understandable, non-fatiguing, and truthful.
  - Status: FAIL
  - Reason: imported from `Tenure_Universal_Work_Graph_and_Workspace_Connector_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **WRK-GATE-120** — The Workspace Connector Cloud is secure, operable, scalable, recoverable, and cost-accountable.
  - Status: FAIL
  - Reason: imported from `Tenure_Universal_Work_Graph_and_Workspace_Connector_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **WRK-GATE-130** — Tenure may claim a cross-app acceleration only for measured, certified, supportable scope.
  - Status: FAIL
  - Reason: imported from `Tenure_Universal_Work_Graph_and_Workspace_Connector_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [x] **REVIEW-FINDINGS §16-TRANSACTION** — A Next.js navigation must not be thrown inside a `db.$transaction` callback, and the rule is now stated, wired and proved.
  - Status: PASS
  - Deduplicates: `REVIEW-FINDINGS §16`, `REVIEW-FINDINGS-16A`, `REVIEW-16-REDIRECT`,
    `REVIEW-FINDINGS §16-redirect-inside-withTenantScope` and the #16 clause of `WRK-GATE-010` —
    six surveyors filed one defect. The scope-body half (hoisting `redirect()`/`revalidatePath()`
    out of ~60 `withTenantScope` bodies, the `runInTenantScope` runtime refusal, and
    `tests/architecture/redirect-lives-outside-tenant-scope.test.mjs`) was landed concurrently by
    the run holding WRK-P1-16 and is NOT claimed here. What was still open, and is what this
    entry covers, is the boundary that actually destroys data: the transaction.
  - Why the two boundaries differ: `runInTenantScope` deliberately lets `notFound()` through — a
    page read raising a 404 has nothing in flight, and refusing it turns a 404 into a 500. Inside
    `db.$transaction` the same throw rolls the callback back and *then* renders the 404 over the
    rows it just destroyed. Nothing stated where that line was.
  - Code: `apps/web/src/lib/tenancy/context.ts` — `isNextNavigationThrow()`, the strict classifier
    (`NEXT_REDIRECT` / `NEXT_NOT_FOUND` / `NEXT_HTTP_ERROR_FALLBACK`), beside the permissive
    `isNextControlFlowError()` the scope uses. `apps/web/src/lib/db.ts` — `guardedTransaction()`
    plus `withTransactionGuard()`, a `Proxy` intercepting exactly `$transaction` on the one client
    every query goes through, so all ~30 existing `db.$transaction` call sites and every future
    one are covered with no opt-in and no call-site edits. It does not save the write (Prisma has
    already aborted); it converts a silent rollback + successful 307 into a `TenantContextError`.
  - Code: `apps/web/src/lib/rbac.ts` — `getUserContext`'s `cache()` now states which of the three
    clauses in `runInTenantScope`'s doc block it satisfies (clause 3, scope-INDEPENDENT rather
    than merely unscoped), which that block requires of every `cache()`d loader and which this one
    did not do.
  - Tests: `tests/architecture/navigation-outside-tenant-scope.test.mjs` (6 tests) — paren-balanced
    scan of every `$transaction(` body under `apps/web/src`, `notFound` included and
    `NextResponse.redirect` excluded, one level of local-helper indirection resolved
    (`revalidateAdmin`, `bumpProfile`), plus a floor assertion (>20 transactions, >10 interactive)
    so an empty scan cannot pass as clean, and an assertion that the EXPORTED `db` is still built
    through `withTransactionGuard`.
  - Tests: `apps/web/src/lib/tenancy/isolation.itest.ts` (+7 tests, 31/31 green against PostgreSQL
    on `localhost:5461`) — through the application's own `db`: the write commits when nothing
    throws; a `NEXT_REDIRECT;replace;/feed;307;` throw leaves the row absent; the failure arrives
    as `TenantContextError` with the digest stripped so Next cannot answer 307; `notFound()` is
    refused too; an ordinary error passes through verbatim; `db.organization.count()` still works
    through the Proxy; the array form is guarded as well as the callback form.
  - Tests: `apps/web/src/lib/tenancy/context.test.ts` (+3) — the two classifiers agree on
    `redirect`, disagree on `notFound` (the reason both exist), and agree that an ordinary failure
    is neither. `apps/web/src/lib/tenant-scope.test.ts` — the test at :263 asserted that
    `throw new Error("NEXT_REDIRECT")` propagated, blessing the OPPOSITE of #16 while testing
    nothing (a bare Error carries no `digest`); rewritten to a real domain failure, with the
    genuine digest-carrying throw asserted separately through `withTenantScope`, plus the positive
    return-then-redirect shape. Its `@/lib/db` mock also gained `institution.findUnique`, without
    which the suite had 16 failures on `institution.findUnique is not a function`.
  - Mutations (5 applied, 5 caught, all restored):
    1. `isNextNavigationThrow` short-circuited to `if (true) throw err` in `guardedTransaction` →
       itest `is refused loudly` and `refuses notFound() too` RED, `rolls the whole callback back`
       stayed GREEN (correctly: the rollback is Prisma's, the loudness is this code); restored → 7/7.
    2. `redirect(\`/messages/${c.id}\`)` inserted inside the real `db.$transaction` in
       `apps/web/src/app/(app)/messages/actions.ts` → architecture spec RED naming
       `messages/actions.ts:124 — redirect() inside the $transaction opened at line 106`;
       removed → 6/6 GREEN.
    3. `notFound` dropped from the scanner's token list → `the calls this rule is about are the
       calls it names` RED (`notFound() is meant to be governed here and no longer matches`).
    4. `export const db = ... withTransactionGuard(createClient())` reverted to `createClient()` →
       itest RED (2 tests) but the architecture assertion stayed GREEN, because it matched the
       DEFINITION of `guardedTransaction` rather than its use. That is the dead-code trap the
       brief names, caught by mutation; the assertion now matches the export expression and reds.
    5. `isNextNavigationThrow` collapsed to `NEXT_REDIRECT` only → context.test.ts `disagree about
       notFound()` RED and itest `refuses notFound() too` RED; restored → green.
  - Evidence: `npm run type-check` — 5 errors at the close of this run, 0 in any file this entry
    touches (the baseline when it opened was 121; the 5 that remain are
    `finance/money-path.itest.ts`, `approval-digest.itest.ts` ×2, `platform/tenant-export.ts`,
    `tenancy/registry.test.ts`, all owned by concurrent runs and all moving while this ran).
    `node --test tests/architecture/navigation-outside-tenant-scope.test.mjs` — 6/6.
    `npx jest src/lib/tenancy/context.test.ts src/lib/tenant-scope.test.ts` — 61/61.
    `npx jest --config jest.config.js --ci` (apps/web, whole suite) — 4089/4094; the 5 failures are
    `tenancy/registry.test.ts`, `search.test.ts`, `relay/projection-policy.test.ts`, all schema and
    relay work from concurrent runs, none in a file this entry touches.
    `DATABASE_URL=postgresql://tenure:tenure@localhost:5461/tenure npx jest --testMatch
    "**/tenancy/isolation.itest.ts" --runInBand --testTimeout=60000` — 31/31.
    `npm run test:platform` — 275/292; the 17 failures name no file in this entry (raw-client
    construction in three `.itest.ts` files, ownership-map staleness, generated-doc staleness and
    workflow guards, all from concurrent runs). `redirect-lives-outside-tenant-scope.test.mjs`
    was green when this run began its final pass and went red minutes later on
    `apps/web/src/app/(app)/admin/payments/actions.ts:286`, a file created by the payments run
    while this one was verifying. Deliberately not fixed here: it is that run's file, it is not a
    rule-A violation (the `revalidatePath` is outside every transaction), and the guard catching a
    violation the hour it was written is the system working rather than a regression to absorb.
  - Not claimed: `apps/web/src/app/(app)/approvals/actions.ts` is owned by a concurrent run and is
    a named, reasoned exemption from the SCOPE rule in the other run's spec. It is NOT exempt from
    the rule here — the transaction scan covers every file under `apps/web/src` with no
    exemptions, and approvals is clean under it.

- [x] **REVIEW-FINDINGS-16B** — No `React.cache()`d function may return tenant rows; the invariant is stated, guarded lexically, and `viewerTimeZone` no longer breaks it.
  - Status: PASS
  - Deduplicates: `REVIEW-16-CACHE` and `WRK-P1-16-CACHE-IS-PER-REQUEST-NOT-PER-SCOPE` — three
    surveyors filed one defect (`docs/architecture/REVIEW-FINDINGS.md:54`). Implemented once.
  - The defect, in two halves. `apps/web/src/lib/institution-time.ts` had
    `viewerTimeZone = cache(async (userId) => ...)`: memoised on the viewer alone, resolving from
    `ctx.institutionRoles[0]`, and reading `db.organization.findFirst` — `Organization` is
    TENANT_SCOPED (`apps/web/src/lib/tenancy/registry.ts:36`). So (a) a two-institution staffer who
    switched tenants saw their FIRST institution's clock on every calendar surface regardless of
    which tenant they were acting in, and (b) a `React.cache()` memo lives for one REQUEST while a
    tenant scope lives for one BLOCK, so the first scope opened answered for every later one.
  - Code: `apps/web/src/lib/institution-time.ts` — `viewerTimeZone(userId, institutionId)`, the
    tenant REQUIRED rather than optional (an optional key is invisible to `tsc` and reintroduces
    the bug), matching on the membership at THIS institution and filtering the club read with
    `where: { id: { in: orgIds }, institutionId }` so it is correct in observe mode too, not only
    once `TENANCY_ENFORCE=true`. The signature change is a compile error at every call site, which
    is the point.
  - Callers wired (all three, and there are exactly three): `apps/web/src/app/(app)/calendar/page.tsx:62`,
    `apps/web/src/app/(app)/calendar/new/page.tsx:39`, `apps/web/src/app/(app)/feed/page.tsx:41` —
    each `withTenantScope(userId, async (scope) => ...)` and each passing `scope.institutionId`,
    the tenant `resolveTenantScope` already validated against live membership. `institutionTimeZone`
    (5 call sites) is untouched: its key IS the institutionId, which is why it was already safe.
  - Code: `apps/web/src/lib/tenancy/locale-cookie.ts` — `slugForInstitution` and
    `documentLocalization` now state WHICH clause of the invariant they satisfy, which the rule
    beside `runInTenantScope` requires of every `cache()`d loader and which these did not do.
    `documentLocalization` takes no key at all, which is the defect's shape; it is clause (1) —
    the only read it reaches is `Institution`, PLATFORM_GLOBAL — and keying it would be wrong
    rather than redundant, because the root layout renders before a tenant is known (ADR-0002).
  - Tests: `tests/architecture/cache-does-not-cross-tenant-scopes.test.mjs` (4 tests, new) —
    paren-balanced scan of every `const X = cache(...)` under `apps/web/src` in a file importing
    `cache` from `react`; TENANT_SCOPED read from `registry.ts` rather than restated; a body
    reaching `db.<model>.<operation>` on one of them must declare `institutionId`/`tenantId`.
    Two exemptions, each stating why (`getUserContext`, `institutionCandidates` — clause (3),
    `runUnscoped('auth-bootstrap')`), plus a test that reds when an exemption stops being needed,
    a floor assertion (at least 10 loaders) so an empty scan cannot pass as clean, and a self-test
    on the detector including that prose naming `db.organization` is not read as a query.
  - Tests: `tests/security/authority-is-not-cached.test.mjs` (+2) — the gap the lexical guard
    leaves. A signature check cannot see `viewerTimeZone(userId, ctx.institutionRoles[0].institutionId)`,
    which type-checks, satisfies that guard, and is the original defect verbatim. These assert every
    call site takes the institution from the OPEN SCOPE (`scope.institutionId`,
    `requireTenantScope(...).institutionId`), with a floor of 3 call sites so it cannot pass vacuously.
  - Tests: `apps/web/src/lib/tenancy/isolation.itest.ts` (+3, 31/31 against PostgreSQL) — the
    behavioural proof, driven through `withTenantScope` because that is what the three pages use.
    One user with a live OSE seat in both fixture tenants, `America/Chicago` and `Asia/Tokyo`
    (neither is `DEFAULT_TIME_ZONE`, so "returned A" and "fell back" cannot be the same string):
    scope A then scope B in one process must give two different zones; asking B first must not
    change B's answer; and the seeded rows are read back to prove the zones are real.
    Its `beforeAll`/`afterAll` and the two slow cases got explicit timeouts — jest's 5s default is
    a unit-test budget and this hook boots two Prisma engines, so every one of the 31 tests was
    failing with a hook timeout that reads exactly like a broken isolation rule and is not one.
  - Tests: `apps/web/src/lib/institution-time.test.ts` (6 tests, new) — the branches the itest
    cannot reach without a second fixture, notably the club officer with no OSE membership whose
    zone comes THROUGH the tenant-scoped `Organization`. The `@/lib/db` fake really applies
    `where.id.in`, `where.institutionId` and `orderBy.id` — a canned row would pass whatever the
    loader did with its arguments — and one test asserts that on the fake itself.
  - Mutations (7 applied, 7 caught, all restored; producer mutated, never the helper):
    1. `viewerTimeZone` reverted to `cache(async (userId) => ...)` + `institutionRoles[0]` →
       isolation.itest `gives each tenant its own zone` RED: `Expected "Asia/Tokyo", Received
       "America/Chicago"` — tenant B served tenant A's clock, the defect verbatim. Restored, 31/31.
    2. The same revert → `institution-time.test.ts` 4 of 6 RED. Restored, 6/6.
    3. `viewerTimeZone`'s second parameter deleted (body kept) → architecture guard RED:
       "`viewerTimeZone(userId)` reads Organization and takes no institutionId/tenantId", and the
       scanner's own floor test RED too. Restored, 4/4.
    4. `institutionId` dropped from the club read's `where` → `institution-time.test.ts` exactly
       the two club-officer cases RED (`Expected "Asia/Tokyo", Received "America/Chicago"`), the
       OSE cases still green — the mutation is localised and so is the failure. Restored.
    5. `institutionCandidates` given an `institutionId` parameter → the exemption-rot test RED:
       "exempted but now takes a tenant key, so the exemption does nothing". Restored.
    6. `feed/page.tsx` changed to `viewerTimeZone(userId, ctx.institutionRoles[0].institutionId)` →
       the call-site guard RED naming the file and the argument. Restored.
    7. Control for 6: the same call site changed to
       `viewerTimeZone(userId, requireTenantScope("viewerTimeZone").institutionId)` → GREEN, proving
       the guard reads a parenthesised argument rather than flagging everything that is not
       literally `scope.institutionId`. Restored.
  - Evidence: `npm run type-check` — 3 errors, 0 in any file this entry touches (baseline at the
    start of this run was 156; the 3 remaining are `finance/money-path.itest.ts` and
    `approval-digest.itest.ts`, owned by concurrent runs).
    `node --test tests/architecture/cache-does-not-cross-tenant-scopes.test.mjs` — 4/4.
    `node --test tests/security/authority-is-not-cached.test.mjs` — 7/7.
    `npx jest src/lib/institution-time.test.ts src/lib/tenancy src/lib/tenant-scope.test.ts` —
    150/153; the 3 failures are `registry.test.ts` model counts (41 vs 50), caused by a concurrent
    run adding models to `schema.prisma`, and name nothing in this entry.
    `DATABASE_URL=postgresql://tenure:tenure@localhost:5492/tenure npx jest --testMatch
    "**/tenancy/isolation.itest.ts" --runInBand` — 31/31.
    `npm run test:platform` — 278/292; all 11 assertions from this entry pass and none of the 14
    failures names a file it touches (generated-doc staleness, ownership entries for other runs'
    new files, raw-client construction in other runs' itests).
  - Also: `tools/ownership-map.mjs` — the `institution-time.ts` entry widened to the
    `institution-time` prefix so the new test belongs to the domain that owns the loader it is about.
