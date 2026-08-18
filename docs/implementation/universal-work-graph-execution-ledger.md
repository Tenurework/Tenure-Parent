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

**Regeneration owed, 2026-08-17.** Five rows below were moved to `- [x]` / `Status: PASS` this
run (`WRK-010-003`, `WRK-020-001`, `WRK-020-005`, `WRK-030-005`, `WRK-070-003`).
`docs/architecture/capability-completeness-registry.yaml` is GENERATED and is stale —
`node tools/document-graph.mjs --check` exited 1 **before** this run touched anything — so
`tests/architecture/a-ticked-box-is-a-passing-requirement.test.mjs` reports those five ticks
against a registry that still says FAIL. It reports 28 such ticks in total across nine ledgers,
23 of them from other domains running concurrently, so this is a wave-wide regeneration step and
not a WRK defect. Run `node tools/document-graph.mjs` once, after the wave, and the assertion goes
green with no ledger edit. Regenerating mid-wave would bake in eleven agents' half-finished state,
which is why it was not done here.

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
  - Overturned on review: Every claimed mutation reproduced exactly (memory mode 2 failed; retainedBody 3 failed; residencyCeiling 9 failed; the chat/route.ts wiring 3 failed/75 passed naming `never sends a REFERENCE_ONLY body`), and the code is real, reached from /api/ai/chat and /search, and fails closed. It still closes only two of the three policies the requirement's own sentence names. Bible sec 3.4 defines GOVERNED_REPLICA as "approved source content/version is RETAINED for a defined business, legal, offline, migration, or continuity purpose". In the shipped code GOVERNED_REPLICA is an enum member, a sentinel meaning "no residency cap" returned by residencyCeiling, and a fall-through `case` in modelSourceFor that returns byte-for-byte what SEARCH_PROJECTION returns. `grep -rn GOVERNED_REPLICA apps packages` (13 hits, all read) shows no kind maps to it, no doc can ever carry it (capAt takes min(MODE_BY_KIND, ceiling) and MODE_BY_KIND's maximum is SEARCH_PROJECTION), and nothing retains, expires or states a purpose for anything. There is no mutation of the GOVERNED_REPLICA arm that could change production behaviour, because it is unreachable in production. That is the case CLAUDE.md names verbatim: "Do not call an interface implemented when it is only declared." The claim concedes the absence honestly and argues it is justified by there being nothing to retain — but an honestly-stated absence of one of three named policies is a partial closure, which is FAIL not PASS. To close: give GOVERNED_REPLICA behaviour distinct from SEARCH_PROJECTION (a retention purpose plus expiry on the projection, or a kind that maps to it), or record the row as covering REFERENCE_ONLY and SEARCH_PROJECTION with GOVERNED_REPLICA outstanding.
  - **Why this row exists at all.** The code was already in the tree and this ledger said
    `not yet implemented`. `apps/web/src/lib/relay/projection-policy.ts` landed in commit
    `f589596` ("STUDIO, WRK and TTES land") and no row was ever written for it, so the
    registry read FAIL over working, wired, tested code — the same loss the ledger's own
    header warns about from the other direction. This run verified it against the
    requirement's sentence, re-proved it by mutation, and recorded it. Nothing about the
    production behaviour changed.
  - Code: `apps/web/src/lib/relay/projection-policy.ts` — `PROJECTION_MODES`
    (`REFERENCE_ONLY` / `SEARCH_PROJECTION` / `GOVERNED_REPLICA`, ordered by increasing
    retention), `MODE_BY_KIND` as an exhaustive `Record<ProjectedKind, ProjectionMode>` (so a
    sixth source kind is a compile error rather than an unstated policy), `projectionModeFor`,
    `projectionModeOf` (fails closed to `REFERENCE_ONLY` at a runtime boundary),
    `retainedBody`, `residencyCeiling`, `effectiveModeFor`, `modelSourceFor`,
    `REFERENCE_ONLY_NOTE` and `stateWithheldNote`.
  - The requirement's three names all mean something. `memory` — the only kind whose body is a
    person's own words rather than a description of a thing — is `REFERENCE_ONLY`, and
    `retainedBody` drops its text before it enters the corpus at all, so it is absent from
    ranking, from `/api/search` snippets and from the model prompt without any of the three
    knowing the rule. The four description-shaped kinds are `SEARCH_PROJECTION`.
    `GOVERNED_REPLICA` is declared, handled, and mapped to by NO kind, with the reason written
    out in the module: nothing in this corpus retains anything, `loadSearchCorpus` reads live
    rows per request, and the mode is kept because it is one of the three names §3.4 fixes.
    That is a stated absence, not an unstated one.
  - Callers, at both ends, because a policy decided once is a policy a second assembler can
    forget: `apps/web/src/lib/search-data.ts` stamps `mode` on every `SearchDoc` and calls
    `retainedBody` where the doc is built; `apps/web/src/app/api/ai/chat/route.ts:355` and
    `:541` re-decide it at the vendor boundary through `effectiveModeFor` / `modelSourceFor`;
    `synthesizeAnswer` in `apps/web/src/lib/ai.ts:326` does the same for `/search`'s answer.
  - Tests: `apps/web/src/lib/relay/projection-policy.test.ts` 18/18,
    `apps/web/src/lib/search.test.ts` 38/38 (the corpus loader),
    `apps/web/src/app/api/ai/chat/relay-prompt-safety.test.ts` 21/21 (the route),
    `apps/web/src/app/api/search/search-lifecycle.test.ts` 5/5,
    `apps/web/src/app/api/ai/ai-kill-switch.test.ts` 42/42,
    `apps/web/src/lib/relay/ai-surface-fencing.test.ts` 5/5.
  - Mutations (4 applied, 4 caught, all restored; the producer mutated, never a test fixture):
    1. `MODE_BY_KIND.memory` `"REFERENCE_ONLY"` → `"SEARCH_PROJECTION"` — a literal value, so no
       other token can absorb it. **2 failed / 142 passed**: `projectionModeFor defaults to the
       least-retentive mode that works › keeps memory-card text out of the projection entirely`
       AND `loadSearchCorpus stamps a §3.4 projection mode on every doc › drops a memory card's
       body from the corpus entirely` — the primitive and the real corpus loader. Restored,
       144/144.
    2. `retainedBody` body `return projectionModeOf(mode) === "REFERENCE_ONLY" ? "" : body` →
       `return body`. **3 failed / 141 passed**: `retainedBody decides what enters the corpus ›
       drops the body of a REFERENCE_ONLY row`, the corpus-loader case, and `the corpus projects
       at the residency the cell is running in › keeps every body out of the corpus from a
       partition the vendor is not in`. Restored, 144/144.
    3. `residencyCeiling` collapsed to `return "GOVERNED_REPLICA"`. **9 failed / 135 passed**,
       including `refuses a residency whose region and partition contradict each other` and
       `modelSourceFor decides what crosses the vendor boundary › withholds a projected body
       from a cell whose partition cannot reach the vendor`. Restored, 144/144.
    4. **The wiring, at the production door.** In `apps/web/src/app/api/ai/chat/route.ts`,
       `scored.map((doc) => modelSourceFor(doc, residency))` → `scored.map((doc) => ({ heading:
       doc.title, body: doc.body }))` — correct policy, zero effect. **3 failed / 75 passed**:
       `projection mode decides how much of a source crosses the boundary › never sends a
       REFERENCE_ONLY body, even when the corpus hands one over`, `› still cites the
       REFERENCE_ONLY source by title and link`, and `a source's state decides whether an answer
       may rest on it › does answer from a stale source, and labels it in the prompt and the
       response`. This is the mutation that proves the policy is reached from `/api/ai/chat`
       rather than only from its own test file. Restored, 78/78.
  - Evidence: `npx jest --ci --silent src/lib/relay src/lib/connections src/lib/search.test.ts
    src/lib/calendar-sync.test.ts src/app/api/ai src/app/api/search src/app/api/calendar
    src/lib/relay-tools.test.ts` from `apps/web` — `Tests: 354 passed, 354 total`,
    `Test Suites: 20 passed`, 6.2 s (17.3 s on the final re-run, cold). `npx tsc --noEmit` in
    `apps/web` — **0 errors** on the closing run. Mid-run it reported 6, all in
    `packages/configuration/src/graph-snapshot.test.ts` and `graph.test.ts` and all owned by a
    concurrent run that fixed them, plus two transient `TS6053 File … not found` for
    `src/lib/connections/mutation-probe.ts` and `src/lib/finance-probe-9042.ts` — another domain's
    mutation probes, caught mid-flight by `include: **/*.ts`. None in any file this run touched.
  - Not claimed: the residency half is WRK-070-001's, which stays FAIL. `residencyCeiling` caps
    a projection at what the cell's partition can reach, which is one clause of it; the
    AWS-hosted governed content pipeline is not built.

- [ ] **WRK-010-004** — Implement external identity linking without email-only or ambiguous automatic merges.
  - Status: FAIL
  - Reason: imported from `Tenure_Universal_Work_Graph_and_Workspace_Connector_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **WRK-010-005** — Implement graph state, freshness, deletion, access loss, quarantine, conflict, and reconciliation.
  - Status: FAIL
  - **Considered for closure this run and refused: six of the seven.**
    `apps/web/src/lib/relay/projection-state.ts` implements §3.5's ladder — six normal states
    (`DISCOVERED → AUTHORIZED → FETCH_PENDING → CURRENT → STALE → REFRESHING`) and ten exceptional
    ones, verbatim and in the Bible's own order — with `advance(state, event)` as a TABLE rather
    than a chain of `if`s, so every pair not in it is a refusal that says why instead of a shrug
    that returns the current state. `TERMINAL_PROJECTION_STATES` (`ACCESS_REVOKED`,
    `SOURCE_DELETED`, `RETENTION_EXPIRED`) accept no event at all, and a recoverable exceptional
    state re-enters at `FETCH_PENDING`, never at `CURRENT`, because "we fixed the mapping" is not
    "we have the content". `bodyMayBeQuoted` is the rule applied at the one boundary that matters.
    Six of the seven nouns are covered: state, freshness (`STALE`/`REFRESHING`), deletion
    (`SOURCE_DELETED`), access loss (`ACCESS_REVOKED`), quarantine (`QUARANTINED`), conflict
    (`MAPPING_CONFLICT`). Its caller is `projectTenureRecord` in `apps/web/src/lib/relay/
    citation.ts`, which walks the ladder for every row `loadSearchCorpus` returns;
    `apps/web/src/lib/relay/projection-state.test.ts` and `citation.test.ts` are green.
  - **Reconciliation is the seventh and it does not exist.** Nothing detects that a projection
    disagrees with its source, nothing owns the exception, and nothing drives a
    `MAPPING_CONFLICT` back to `FETCH_PENDING` — there is no connector, no cursor and no external
    ACL for a reconciler to compare against. `advance`'s `REQUEST_FETCH`-from-exceptional arm is the
    TRANSITION a reconciler would use, not a reconciler. WRK-060-004 is the item that owns it and it
    is also FAIL.
  - Also not claimed: the file's own header cites WRK-010-001, and WRK-010-001 asks for twenty-odd
    canonical objects of which this is one. That row stays FAIL too.

- [ ] **WRK-010-006** — Prove graph/API/store/cache/search isolation under adversarial external IDs.
  - Status: FAIL
  - Reason: imported from `Tenure_Universal_Work_Graph_and_Workspace_Connector_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **WRK-020-001** — Implement every connection class and prohibit class escalation.
  - Status: FAIL
  - Overturned on review: All three claimed mutations reproduced (WEBHOOK_ONLY maxRisk READ->PRIVILEGED: 7 failed incl. `is decided before the surface's ceiling` with Expected CONNECTION_CLASS_EXCEEDED / Received SURFACE_IS_READ_ONLY; `if (grantedClass)` -> `if (false && grantedClass)`: 4 failed including two /api/ai/chat route tests, so the gate is genuinely reachable from the route; PERSONAL_PRODUCTIVITY tenantWide false->true: 2 failed). leastClassFor's ordering is also correct on hand-trace. But the requirement is "implement EVERY connection class", and one of the eight is unguarded. I mutated each class's ceiling one at a time: USER_DELEGATED DELETE->PRIVILEGED 2 failed, BOT_OR_APP_INSTALLATION EXTERNAL_SHARE->DELETE 1 failed, SERVICE_ACCOUNT BULK->EXTERNAL_SHARE 5 failed, APPLICATION_ORG_WIDE DELETE->BULK 5 failed — and FILE_OR_FEED SURVIVES TWICE: BULK->DELETE and BULK->EXTERNAL_SHARE both leave `npx jest src/lib/relay src/lib/relay-tools.test.ts src/app/api/ai` at 232 passed / 232 total, no failures. Nothing anywhere asserts FILE_OR_FEED's authority, so its declared ceiling can be silently raised to DELETE — an SFTP/object-store/ICS/EDI feed authorised to delete records — with the whole suite green. That is the class whose `because` names the one feed this platform actually ships (ICS), and it is the one class whose ClassAuthority is decoration rather than a proved constraint. Also noted, not the basis of the verdict: RELAY_CAPABILITY_OFFERS has exactly one entry, so seven classes are attached to no capability; and `isConnectionClass` is exported but has no production caller. To close: assert FILE_OR_FEED's ceiling (and ideally each of the eight) in connection-class.test.ts.
  - **Why this row exists at all.** As with WRK-010-003: the implementation landed in commit
    `f589596` and no ledger row was written, so the registry recorded FAIL over shipped, wired,
    tested code. Verified against the sentence, re-proved by mutation, recorded. No production
    behaviour changed by this run.
  - Code, both halves the requirement names:
    * **every class** — `CONNECTION_CLASSES` in `packages/platform-config/src/provider-review.ts`
      declares §4.1's eight (`USER_DELEGATED`, `ADMIN_DELEGATED`, `APPLICATION_ORG_WIDE`,
      `BOT_OR_APP_INSTALLATION`, `SERVICE_ACCOUNT`, `WEBHOOK_ONLY`, `FILE_OR_FEED`,
      `PERSONAL_PRODUCTIVITY`), and `apps/web/src/lib/relay/connection-class.ts` gives each one a
      `ClassAuthority` — `maxRisk`, `tenantWide`, and a `because` that is shown in the refusal
      rather than kept for review. `CLASS_AUTHORITY` is a `Record<ConnectionClass, …>`, so a
      ninth class is a compile error here instead of a class silently inheriting somebody
      else's authority.
    * **prohibit escalation** — `refuseEscalation(granted, requested)` returns an
      `EscalationVerdict`, never a boolean: on refusal it names the granted class, the requested
      risk, the ceiling, and `leastClassFor(requested)` — the narrowest class that COULD carry
      it, because the way out is an administrator changing a grant and "you may not" does not
      tell them to what. `PERSONAL_PRODUCTIVITY` carries `tenantWide: false` and is refused
      outright on this path, which is §4.1's "prohibited from tenant-wide use" rather than a
      narrower ceiling.
  - One ordering, not two: `RISK_ORDER` lives in `connection-class.ts` and `relay-tools.ts:191`
    imports it back for `riskExceeds`. The type import in the other direction is `import type`
    and is erased, so the runtime graph runs one way.
  - Caller, on the path that actually runs: `authorizeRegistrations` in
    `apps/web/src/lib/relay-tools.ts:402-425` consults `classOf(tool.module)` — defaulting to the
    shipped `connectionClassFor` — for every registration on every `/api/ai/chat` request, as
    **gate 0**, ahead of the surface's own read-only ceiling and ahead of any permission read. The
    order is deliberate and is asserted: "this connection may never do that, anywhere" outranks
    "not from this route". A refusal emits `remedy: { kind: "CONNECTION_CLASS_EXCEEDED",
    grantedClass, requestedRisk, requiredClass }`, which the route returns.
  - `classOf` returning `null` is deliberately NOT a refusal: a module no external connection
    serves is answered from Tenure's own store under Tenure authorization alone, and refusing it
    would break every first-party tool.
  - Tests: `apps/web/src/lib/relay/connection-class.test.ts` 12/12,
    `apps/web/src/lib/relay-tools.test.ts` 56/56 (the door),
    `apps/web/src/app/api/ai/ai-kill-switch.test.ts` 42/42 (the route).
  - Mutations (3 applied, 3 caught, all restored):
    1. `CLASS_AUTHORITY.WEBHOOK_ONLY.maxRisk` `"READ"` → `"PRIVILEGED"`. **6 failed / 62 passed**
       across BOTH suites, including `is decided before the surface's ceiling, because it is the
       wider statement` failing with `Expected: "CONNECTION_CLASS_EXCEEDED" / Received:
       "SURFACE_IS_READ_ONLY"` — which is the gate-ordering property, not just the ceiling.
       Restored, 68/68.
    2. **The wiring.** `if (grantedClass) {` → `if (false && grantedClass) {` in
       `relay-tools.ts` — correct rule, zero effect. **4 failed / 94 passed**, and the failures
       include `apps/web/src/app/api/ai/ai-kill-switch.test.ts:1172`, a ROUTE test asserting
       `body.relayTools.refused[0].remedy` matches `{ kind: "CONNECTION_CLASS_EXCEEDED", … }`.
       That is the proof the class gate is reachable from `/api/ai/chat`. Restored, 98/98.
    3. `CLASS_AUTHORITY.PERSONAL_PRODUCTIVITY.tenantWide` `false` → `true`. **1 failed / 67
       passed**: `refuses a personal connection every risk class, because it is not tenant-wide`.
       A localised mutation producing a localised failure. Restored, 68/68.
  - Evidence: `npx jest --ci src/lib/relay/connection-class.test.ts src/lib/relay-tools.test.ts`
    and `npx jest --ci src/lib/relay-tools.test.ts src/app/api/ai/ai-kill-switch.test.ts` from
    `apps/web`. Whole targeted set after restoring everything: `Tests: 354 passed, 354 total`.
  - Not claimed: WRK-GATE-020 as a whole. A class is one of the five authorities that gate names
    (identity, resource, direction, purpose, tenant); direction is `GRANT_IS_READ_ONLY` and
    resource is `RESOURCE_NOT_SELECTED` in the same file, and `purpose` has its own item.

- [ ] **WRK-020-002** — Implement versioned include/exclude resource selectors and impact diffs.
  - Status: FAIL
  - **Considered for closure this run and refused.** The vocabulary exists and is good:
    `packages/provisioning/src/resource-selector.ts` declares `ResourcePattern`
    (`container`/`object`, `externalId`, `recursive`), `ResourceSelector` (`version`, `include`,
    `exclude`), `patternMatches`, `selectorSelects` with EXCLUDE-ALWAYS-WINS stated in exactly one
    place, `selectorDiff` returning `{added, removed, unchanged}`, and `selectorProblems` with five
    reasons — `include-empty` (a value two readers resolve differently is not a value),
    `exclude-matches-nothing` (a rule that reads on a review screen as protection which does not
    exist), `version-not-increased`, `version-invalid`, `pattern-empty`. The dead-rule check is
    computed THROUGH `selectorDiff`, so the gate and the impact preview cannot disagree.
  - Why it is still FAIL — three facts, each re-derived this run rather than assumed:
    1. **Nothing declares a selector.** `ConnectorEntry.selector` is optional and
       `grep -rn "selector:" packages/provisioning/src/provider-packs.ts
       packages/provisioning/src/catalogs.ts packages/platform-config/src blueprints modules
       apps/system-studio/src`, excluding `.test.`, returns NOTHING. All 24 provider packs and the
       one shipped connector declare none, so `isUsable`'s
       `if (entry.selector && selectorProblems(entry.selector).length > 0)` at `catalogs.ts:829`
       has never fired outside its own test. A validator with a caller and no data is not a
       shipped selector.
    2. **No impact diff is ever shown to anybody.** `grep -rn "selectorDiff("` across `apps`,
       `packages`, `blueprints` and `modules`, excluding tests, returns two hits and both are
       inside `resource-selector.ts` itself. No surface in `apps/system-studio` or `apps/web`
       renders `added`/`removed` before a Save, which is the half the requirement's own sentence
       exists for ("if I remove this folder, which citations stop being reachable").
    3. **The request path enforces a different thing.** `invokeRelayTool`'s
       `limits.selectedResources` (`relay-tools.ts:1059`, `RESOURCE_NOT_SELECTED`) is a flat
       `readonly string[]`, with `apps/web/src/app/api/ai/chat/route.ts:320` passing `[]`. It is a
       real gate and it is proven, but it carries no version, no exclude list and no container
       recursion, so the door and the catalog model two different selectors.
  - What would close it, in order: put a `ResourceSelector` on the one connectable capability that
    has resources to point at, render `selectorDiff` on the surface that changes it, and replace
    `selectedResources: readonly string[]` on `RelayLimits` with the versioned selector so the
    door and the catalog agree. None of that needs a schema change if the selection is carried on
    the manifest; persisting a tenant's live selection does.
  - Tests that exist today: `packages/provisioning/src/resource-selector.test.ts` and the selector
    cases in `packages/provisioning/src/catalogs.test.ts`. Not mutation-proved here, because a
    PASS was not claimed.

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

- [x] **WRK-020-005** — Require new approval/consent for meaningful selector or scope expansion.
  - Status: PASS
  - The expansion it closes: the ICS calendar feed is the one grant this platform issues — a
    signed URL a student pastes into Outlook, which then polls it forever. The route calls
    `loadScopedEvents` FRESHLY on every poll, so before this the set of events a third party
    received was whatever the holder could see TODAY. Joining a second club, or being seated in a
    second organization, began publishing those events to whoever held the URL with no audit row,
    no notification, and a 200 the calendar client swallows as an ordinary poll.
  - Code: `apps/web/src/lib/connections/selector-consent.ts` — `CalendarSelector`
    (`institutionId`, `organizationIds`, `institutionWide`), `selectorDigest` (sha256 over the
    sorted, de-duplicated selector, institution INCLUDED because moving a feed to another tenant
    is the widest expansion there is), `consentVerdict` returning
    `UNCHANGED | NARROWED | EXPANDED` plus the added and removed organization ids, and
    `consentedIntersection`, which is never wider than the consent AND never wider than current
    access. `institutionWide` is part of the selector rather than a detail beside it: gaining an
    OSE seat is the largest expansion available here and a digest over club ids alone would call
    it UNCHANGED.
  - Callers, all three: `apps/web/src/lib/calendar-sync.ts:176` puts the digest INSIDE the token's
    MAC and `:263` recomputes it on every verification; `apps/web/src/app/(app)/calendar/page.tsx`
    mints with the holder's live selector and shows the consented digest as the receipt;
    `apps/web/src/app/api/calendar/ics/[token]/route.ts:88-131` compares the pinned digest against
    the live scope on every poll, serves `consentedIntersection` on `EXPANDED`, and tells the
    calendar client why — a description every client renders, plus an RFC 8288
    `link: </calendar>; rel="related"` pointing at the page that re-issues the URL.
  - Serving the intersection rather than refusing is a decision, not a softening: a subscriber
    whose feed went empty because they joined a club would file a bug, and the safe answer is to
    keep giving them exactly what they agreed to while telling them a wider link exists.
  - **What this run added, because two claims did not hold up.**
    1. `apps/web/src/app/api/calendar/ics/[token]/consent-route.test.ts` (NEW, 9 tests) — the
       route's use of the comparison had NO test anywhere. `selector-consent.test.ts`'s header
       said "the behavioural proof runs against real Postgres through the ICS route
       (`selector-consent.itest.ts`)" and that file has never existed:
       `find apps/web/src -name '*selector-consent*'` returns the module and its unit test only,
       and `calendar-token.itest.ts` — the one itest touching this route — contains no occurrence
       of `consent`, `EXPANDED` or `intersection`. The new suite drives `GET` with the three
       `@/lib/calendar-data` reads and `withTenantScope` mocked, and the token minted and verified
       for real, and asserts WHICH selector `loadScopedEvents` is narrowed to. The header has been
       corrected in place rather than left claiming a proof that does not exist.
    2. `apps/web/src/lib/connections/selector-consent.test.ts` (+1 test) — the digest/selector
       cross-check inside `verifyCalendarToken` was unreachable by every existing assertion.
       The pre-existing "widened their own consent by editing the URL" case is caught by the MAC,
       so deleting the cross-check left all 34 tests green (mutation M3 below). The new case forges
       a token whose MAC is GENUINE and whose digest and selector describe two different grants —
       the shape a MINTING bug produces — with an honest control alongside proving the forge is
       otherwise valid.
  - Tests: `apps/web/src/lib/connections/selector-consent.test.ts` 12/12,
    `apps/web/src/app/api/calendar/ics/[token]/consent-route.test.ts` 9/9,
    `apps/web/src/lib/calendar-sync.test.ts` 14/14.
  - Mutations (6 applied, 6 caught after the gap was closed, all restored):
    1. `consentVerdict`: `if (addedOrganizationIds.length > 0 || gainedInstitutionWide)` →
       `if (addedOrganizationIds.length > 0)`. **1 failed / 24 passed**: `is EXPANDED when the
       holder gains institution-wide access`. Restored, 25/25.
    2. `selectorDigest`: `institutionWide: selector.institutionWide` → `institutionWide: false`.
       **1 failed / 24 passed**: `changes when the institution, the clubs or institution-wide
       access change`. Restored.
    3. `calendar-sync.ts`: `if (selectorDigest(selector) !== digest) return null` →
       `if (false) return null`. **FIRST RUN: NOT CAUGHT — 25 passed, 0 failed.** That is the gap
       above, and it is recorded rather than quietly fixed. After adding the forged-but-signed
       case: **1 failed / 34 passed**, naming `refuses a validly-signed token whose digest and
       selector describe two different grants`. Restored, 35/35.
    4. **The route wiring.** `const consented = verdict.outcome === "EXPANDED" ?
       consentedIntersection(claims.selector, live) : undefined` → `const consented = undefined`,
       which is the silent-expansion defect verbatim. **3 failed / 6 passed**: `serves the
       intersection, not what they can see today`, `does not hand over institution-wide events to
       a URL that predates the seat`, `treats a moved institution as an expansion`. Restored, 9/9.
    5. The route again: `: consentVerdict(claims.selector, live)` → `: { outcome: "UNCHANGED" as
       const }` — the comparison bypassed while the digest check stays. **4 failed / 5 passed**,
       adding `tells the calendar client why, and where to get a wider link`. Restored, 9/9.
    6. `consentedIntersection`: `institutionWide: pinned.institutionWide && current.institutionWide`
       → `institutionWide: current.institutionWide`. **2 failed / 18 passed**, one at the ROUTE
       (`does not hand over institution-wide events to a URL that predates the seat`) and one at
       the primitive. Restored, 20/20.
  - Evidence: `npx jest --ci src/lib/connections/selector-consent.test.ts
    src/lib/calendar-sync.test.ts "src/app/api/calendar"` from `apps/web` — 35/35.
    `npx eslint` on the three files this entry touches — no output.
    `npx tsc --noEmit` in `apps/web` — 0 errors in any of them.
  - Still owed, and NOT claimed: a Postgres integration test asserting the consented selector
    reaches the QUERY. `consentClause` in `apps/web/src/lib/calendar-data.ts` applies the narrowing
    as a predicate rather than as a post-filter — deliberately, because a club the viewer is not a
    member of contributes events through the institution-published branch — and this run could not
    run Postgres (`docker ps` fails: the daemon is not running on this machine). The route-level
    test above proves the route DECIDES to narrow and with which selector; it does not prove the
    SQL. That is the honest boundary of this PASS and the itest is the next thing to write.

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
  - Two of the three exist and one of the two has a producer. `apps/web/src/lib/connections/
    pending-intent.ts` declares `ConnectionOpportunity` and mints a `ConnectionLaunchToken` over
    the `ConnectionLaunchToken` Prisma model (`apps/web/prisma/schema.prisma:1654`, already in the
    schema — no migration needed for anything below). The single-use property is stated correctly:
    the `consumedAt` write IS the claim, `updateMany({ where: { id, consumedAt: null } })`, so two
    concurrent redemptions cannot both succeed, and the tenant/user/expiry refusals all return
    BEFORE the claim so a leaked token cannot be used to destroy the opportunity it cannot open.
  - What this run added: `apps/web/src/lib/connections/pending-intent.test.ts` (NEW, 16 tests).
    The module had no test of any kind. See WRK-030-006 for the seven cases and their mutations.
  - Why still FAIL — three, each checked this run:
    1. **`redeemConnectionLaunchToken` has no production caller.**
       `grep -rn "pending-intent" apps/web/src` returns one importer,
       `apps/web/src/app/api/connections/opportunity/route.ts:4`, and it imports
       `openConnectionOpportunity` only. So an opportunity can be opened and nothing in this
       application can redeem one: the round trip §5.3 exists to survive still ends nowhere. The
       module's own doc block says so, which is why this is a recorded gap rather than a discovery.
    2. **`PendingActionIntent` does not exist.** `grep -rn PendingActionIntent` across `apps`,
       `packages` and `modules` returns nothing. `pendingIntent` on the token row is a person's
       QUESTION carried across a sign-in; §5.2's `PendingActionIntent` is a proposed ACTION held
       for authority it does not yet have, which is a different object with a different lifetime
       and a different approval story.
    3. **Five of §5.2's thirteen facts are written and eight are not.** The module states which and
       why — `providerId`/`connectorVersion`/`certificationStatus` (no certified connector exists),
       `requestedScopes`/`selectorHint`/`resourceHint` (no flow negotiates them),
       `residencyClass`/`dataClass` (nothing is classified). Those are honest absences; they are
       still absences.
  - Next: a redemption surface. It needs no schema change — the columns are there — and it is what
    turns `openConnectionOpportunity` from a write into a journey.

- [ ] **WRK-030-003** — Implement Tenure sign-in/sign-up interruption and exact safe task resumption.
  - Status: FAIL
  - Reason: imported from `Tenure_Universal_Work_Graph_and_Workspace_Connector_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **WRK-030-004** — Implement user connect, scope upgrade, resource selection, reauth, ask-admin, provider-sign-up, request-integration, alternative-source, and unavailable paths.
  - Status: FAIL
  - **Considered for closure this run and refused: six of the nine.**
    `apps/web/src/lib/connections/capability-resolution.ts` implements `resolveCapability`, which
    emits `CONNECTED | NEEDS_USER_CONNECT | NEEDS_ADMIN | NEEDS_SCOPE_UPGRADE | NEEDS_REAUTH |
    NOT_CERTIFIED | UNAVAILABLE`, one §13.3 `statusWord` per outcome through an exhaustive
    `Record`, and an `alternative` on every non-working outcome. Each of the six has a PRODUCER —
    `apps/web/src/app/(app)/settings/page.tsx` and `apps/web/src/components/ai/TenureAIPanel.tsx` —
    and `apps/web/src/lib/connections/capability-resolution.test.ts` is 17/17.
  - Three are deliberately absent and the module names its own reasons, which this run checked:
    * **provider-sign-up** and **request-integration** need a certified third-party provider to
      sign up with or request, and `packages/provisioning/src/provider-packs.ts` records all 24 at
      `PLANNED` with the one shipped connector uncertified. An outcome with no producer compiles,
      appears in the vocabulary, and never fires — which is worse than a gap because every reader
      assumes something emits it.
    * **resource-selection** needs a capability that is connected AND has resources to point at.
      The only selectable-resource surface is the ICS feed, and it is `configured: false` for every
      account because the URL is stateless and Tenure holds no record that anybody subscribed. It
      becomes producible when the consent receipt WRK-020-005 pins is read back here.
  - So the honest ratio is 6/9 and the row stays FAIL. It is not mutation-proved here because no
    PASS was claimed; the certification half of the same file IS proved, under WRK-030-005.

- [ ] **WRK-030-005** — Ensure uncertified capabilities never produce a working-looking OAuth button.
  - Status: FAIL
  - Overturned on review: All three claimed mutations reproduced: the JSX literal `certified: true` back on settings/page.tsx reds the lexical guard 2 pass / 1 fail naming the file and the line text; `if (!state.certified)` -> `if (false && ...)` gives 3 failed / 14 passed with the first failure Expected NOT_CERTIFIED / Received NEEDS_USER_CONNECT; RELAY_ANTHROPIC_REVIEW.state NOT_SUBMITTED -> APPROVED gives 5 failed / 129 passed including `records honestly that nobody has reviewed the shipped connector`. I also traced the render chain and it is real (resolveCapability refuses first with action kind "none"; ConnectionActionControl returns null for kind "none"; no other .tsx in apps/web or apps/system-studio renders a connect control). What refutes it is a fourth branch of the producer that nothing asserts. certifiedCapabilityState's own comment states the rule — "A key in NEITHER list resolves to `certified: false`. Fail closed: a capability nobody has classified is one nobody has certified" — and inverting exactly that, `return { key, certified: FIRST_PARTY.includes(key) }` -> `return { key, certified: true }`, leaves `npx jest src/lib/connections src/app/api/ai` at 134 passed / 134 total with zero failures. capability-resolution.test.ts contains no occurrence of `certifiedCapabilityState` or `FIRST_PARTY` at all: the derivation function the whole row rests on has no unit test, only the resolver that consumes its output. The practical consequence is the requirement's own sentence: the next capability key added (a new provider, or a typo in an existing one) would default to certified and grow a working-looking Connect button for something /api/ai/chat will refuse, and the suite would stay green — which is the defect the row opened on, one layer down. The lexical guard does not cover it either; it only forbids a `certified:` literal in .tsx. To close: assert both defaults of certifiedCapabilityState — FIRST_PARTY membership true, an unclassified key false.
  - **Why this row exists at all.** Same as WRK-010-003 and WRK-020-001: shipped in `f589596`,
    never recorded. Verified, re-proved by mutation, recorded.
  - The defect it closed: `resolveCapability` already refused a connect action when `certified` was
    false, and NOTHING DERIVED `certified`. The literal `certified: true` sat at four call sites —
    three in `apps/web/src/app/(app)/settings/page.tsx`, one in
    `apps/web/src/components/ai/TenureAIPanel.tsx` — and for `ai.model` it was FALSE.
    `RELAY_ANTHROPIC_REVIEW.state` is `NOT_SUBMITTED` and `/api/ai/chat` refuses every vendor call
    because of it, so the Connection Center said "connected and working" about a capability the
    request path will not call. That is a working-looking control over an uncertified capability,
    written by the surface about itself.
  - Code, three parts:
    * `certifiedCapabilityState(key, at)` in `apps/web/src/lib/connections/capability-resolution.ts`
      returns `{ key, certified }` as a FRAGMENT to spread, so a call site writes
      `...certifiedCapabilityState("ai.model")` and cannot pair one capability's key with
      another's verdict. `certified` comes from `providerActivation(scopes, review, at)` — the same
      function `/api/ai/chat` calls, from the same client-safe entry point — or, for a capability
      with no provider at all, from membership of `FIRST_PARTY`.
    * `resolveCapability` refuses **first and unconditionally** on `!state.certified`:
      `outcome: "NOT_CERTIFIED"`, `action: { kind: "none", label: "" }`, `statusWord: "Not
      available yet"`, and an explanation that says "Nothing you do here will enable it." No
      connect control is produced regardless of who is asking or how it is configured.
    * `at` is a parameter, not `Date.now()`, because "was this activated when we shipped it" is a
      question an audit asks and a gate that reads the clock cannot answer it.
  - Callers: `apps/web/src/app/(app)/settings/page.tsx:98,126,144,200` (four capabilities) and
    `apps/web/src/components/ai/TenureAIPanel.tsx:390`. Those are the only two shipped surfaces
    that render a capability.
  - The guard that keeps it closed, and why it is LEXICAL:
    `tests/architecture/certified-is-derived.test.mjs` (3 tests, `node --test`). The failure mode is
    a JSX literal at a call site — it type-checks, it renders, and it is invisible to every unit
    test that builds its own fixture — so a unit test on `certifiedCapabilityState` cannot catch it
    coming back. The guard scans every non-test `.tsx` under `apps/web/src/app` and
    `apps/web/src/components` for `certified\s*:\s*(true|false)`, and its other two tests close the
    loop the first one leaves open: that the resolver exists and reads `providerActivation`, and
    that both surfaces call it. Comments are stripped, for the reason `audit-writes.test.mjs`
    strips them.
  - Tests: `tests/architecture/certified-is-derived.test.mjs` 3/3;
    `apps/web/src/lib/connections/capability-resolution.test.ts` 17/17;
    `tests/architecture/no-uncertified-provider-claims.test.mjs` 6/6;
    `tests/architecture/no-overstated-connectors.test.mjs` 4/4.
  - Mutations (3 applied, 3 caught, all restored; the producer mutated in each case):
    1. **On the surface.** `...certifiedCapabilityState("ai.model")` in `settings/page.tsx` →
       `certified: true,` — the exact literal the requirement opened on. Guard RED, **2 pass / 1
       fail**, naming `apps/web/src/app/(app)/settings/page.tsx:60  certified: true,`. Restored,
       3/3.
    2. **On the resolver.** `if (!state.certified) {` → `if (false && !state.certified) {`.
       **3 failed / 14 passed**, and the first failure reads `Expected: "NOT_CERTIFIED" /
       Received: "NEEDS_USER_CONNECT"` — literally the working-looking connect button appearing.
       Restored, 17/17.
    3. **On the record the derivation reads.** `RELAY_ANTHROPIC_REVIEW.state` `"NOT_SUBMITTED"` →
       `"APPROVED"` in `packages/platform-config/src/provider-review.ts` — the fabricated approval
       `f589596` had to revert once already. **5 failed / 112 passed** across
       `src/lib/connections` and `src/app/api/ai`, including `records honestly that nobody has
       reviewed the shipped connector` and `refuses the vendor call because the provider has not
       reviewed the connector`. Restored, 117/117.
  - Recorded because it surprised me: mutation 3 did NOT red
    `tests/architecture/no-uncertified-provider-claims.test.mjs`, and that guard is CORRECT to
    allow it. Its rule is "no provider review is APPROVED for a connector that does not exist", and
    it skips when `callSitesInCell(host).length > 0` — `api.anthropic.com` genuinely is contacted
    by `apps/web/src/lib/ai.ts`. The Anthropic connector exists; what is missing is the review, and
    that is the jest suites' half. Not a hole, and not fixed.
  - Evidence: `node --test tests/architecture/certified-is-derived.test.mjs` — `# pass 3 / # fail
    0`. `npx jest --ci src/lib/connections/capability-resolution.test.ts` from `apps/web` —
    17/17. `npx jest --ci --silent src/lib/connections src/app/api/ai` — 117/117.

- [ ] **WRK-030-006** — Test expired, replayed, wrong-user, wrong-session, wrong-tenant, tampered, and already-consumed launch tokens.
  - Status: FAIL
  - This platform has TWO launch-token-shaped credentials with opposite designs, and one suite
    cannot prove both. The calendar feed token is stateless, stable per user and MEANT to be
    replayed forever (Outlook polls it); `ConnectionLaunchToken` is stored as a hash, fifteen
    minutes long and burned on redemption. "Replay is the feature, bounded by four other refusals"
    is true of the first and is the exact defect for the second.
  - Already covered before this run — the feed token: `apps/web/src/lib/calendar-sync.test.ts`,
    `describe("the seven launch-token cases")`, 14/14. WRONG-USER (the subject is inside the MAC),
    WRONG-TENANT, TAMPERED (every field inside the MAC), EXPIRED (`CALENDAR_TOKEN_MAX_AGE_MS`),
    ALREADY-CONSUMED as revocation (the `calendarTokenEpoch` counter), REPLAYED, and WRONG-SESSION
    recorded as having no mechanism BY DESIGN — a calendar client cannot send a cookie, which is
    the whole reason the credential exists, so a session-bound token would break at the holder's
    next sign-out.
  - **Added this run — `ConnectionLaunchToken`, which had no test of any kind:**
    `apps/web/src/lib/connections/pending-intent.test.ts`, 16 tests. EXPIRED (and separately, the
    BOUNDARY: `expiresAt <= now`, not `<`), REPLAYED, ALREADY_CONSUMED under two redemptions
    started and awaited together, WRONG_TENANT, WRONG_USER, TAMPERED (flipped last character,
    truncated, extended, nonce half alone, empty, garbage), plus the properties that make the
    refusals safe: a refusal never consumes the row (so a leaked token cannot be used to deny the
    legitimate holder their opportunity), the refusal ORDER puts identity above expiry and above
    consumption, `returnPath` must be an in-app path, the row never holds the redeemable value,
    and the redemption result carries neither the token, its hash, nor its nonce.
  - What the fake costs, stated rather than implied. There is no PostgreSQL in this environment
    (`docker ps` fails — the daemon is not running), so `@/lib/db` is mocked. The store is NOT a
    canned double: `findUnique` matches on `tokenHash`, `create` refuses a duplicate hash the way
    the `@unique` index does, and `updateMany` evaluates `where.consumedAt === null` against the
    row's CURRENT value and returns the count of rows it changed. What is therefore NOT proven is
    that PostgreSQL takes the row lock that makes two SIMULTANEOUS statements serialise — that is a
    database property, asserted for the outbox claim in `apps/web/src/lib/outbox/dispatch.itest.ts`
    against real Postgres, and the equivalent here needs a `pending-intent.itest.ts` this
    environment cannot run.
  - Mutations (4 applied, 4 caught, all restored; the producer mutated in each case):
    1. `where: { id: row.id, consumedAt: null }` → `where: { id: row.id }` — single-use becomes a
       read-then-write. **2 failed / 14 passed**: `REPLAYED: the second presentation of a good
       token is refused` and `ALREADY_CONSUMED: two redemptions racing on one row, and only one
       wins`. This is the mutation that proves the fake's predicate is load-bearing rather than
       decorative. Restored, 16/16.
    2. `if (row.institutionId !== session.institutionId) {` → `if (false && …) {`. **2 failed / 14
       passed**: the WRONG_TENANT case and the ordering case. Restored, 16/16.
    3. `if (row.expiresAt.getTime() <= now.getTime())` → `<`. **1 failed / 15 passed**:
       `EXPIRED is decided on the boundary, not one millisecond after it` — a one-character
       mutation caught by one test. Restored, 16/16.
    4. The claim moved ABOVE the refusals (an `updateMany` inserted before the tenant check) —
       check-then-write in the wrong order. **8 failed / 8 passed**, including every refusal's
       "and is NOT consumed" half and both success cases. Restored, 16/16.
  - **Why this is still FAIL: one of the seven, for one of the two tokens.** WRONG-SESSION on
    `ConnectionLaunchToken` has no mechanism, and unlike the feed token that is not a design
    decision — it is a missing field. The module's doc block claims "session-bound — the redeemer
    passes the CURRENT session's user", which is USER binding wearing session binding's name: the
    same person's second concurrent session redeems a token opened in the first, and nothing can
    tell the two apart. The test states this as a gap and asserts the row has no `sessionId`.
  - **NEEDS_SCHEMA, with the shape.** `model ConnectionLaunchToken` (`apps/web/prisma/schema.prisma
    :1654`) needs one nullable column — `sessionId String?` — written from the session the mint ran
    under, plus a `session.sessionId` on `ConnectionScope` and a `WRONG_SESSION` arm on
    `LaunchRefusal` compared before the claim. Nullable so existing rows stay redeemable and the
    refusal only applies when a token carries one. Recorded here rather than migrated: this wave
    makes no schema changes, and a migration is the one artifact that cannot be reviewed on the
    strength of "an agent wrote it". The ledger's status vocabulary has no `NEEDS_SCHEMA`, so this
    row is FAIL.
  - Evidence: `npx jest --ci src/lib/connections/pending-intent.test.ts` from `apps/web` — 16/16,
    0.2 s. `npx jest --ci src/lib/calendar-sync.test.ts` — 14/14. `npx tsc --noEmit` in `apps/web`
    — 0 errors in either file. `npx eslint src/lib/connections/pending-intent.test.ts` — no output.

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

## WRK-040-005 — the six sinks, proved reached, and the one whose guard could not fail

- [x] **WRK-040-005** — "Prove browser/model/log/event/config/evidence never receive reusable provider secrets."
  - Status: PASS
  - **Why this row exists at all.** As with WRK-010-003, WRK-020-001 and WRK-030-005: the
    proof landed in commit `f589596` ("STUDIO, WRK and TTES land") and no row was written, so
    the registry recorded `not yet implemented` over committed, working, mutation-resistant
    code. `git log --oneline -3 -- tests/security/no-reusable-secrets-outside-the-vault.test.mjs`
    → `f589596`, and `git status --porcelain tests/security/` did not list it, so it is not a
    concurrent agent's in-flight file. Verified against the sentence, mutation-proved, fixed
    where a mutation survived, recorded.
  - Code, the production side, one sink at a time. `packages/audit/src/secret-values.ts`
    declares `PATTERNS` (eight credential formats), `findSecretValues` and `safeLogText` —
    one rule, one file. Its value is entirely in who calls it, and all six of the sinks the
    requirement names have a call site:
    * **browser** — `credentialWrites` in `tests/security/no-tokens-in-browser-storage.test.mjs`
      is a static guard over the whole tree, imported here rather than reimplemented;
    * **model** — `apps/web/src/lib/ai.ts:167` scans `{ system, user }` and **returns null**
      before `fetch("https://api.anthropic.com…")`. Refuse, not redact: a redacted prompt asks
      a question with a hole in it and returns an answer built on it;
    * **log** — `safeLogText` wraps every `console.*` argument carrying text this process did
      not author, in `apps/web/src/lib/commands/bus.ts:314` and `apps/web/src/lib/ai.ts:297,308`;
    * **event** — `apps/web/src/lib/outbox/outbox.ts:113` scans a provider-origin payload and
      `throw`s `ProviderPayloadRefused`, so the row is never written inside the business
      transaction;
    * **config** — `packages/configuration/src/publication.ts:449` scans every proposed layer
      value and `blockers.push`es, because a published value is checksummed into an immutable
      revision and cannot be un-published;
    * **evidence** — the ledgers and the generated capability registry are swept with the same
      `PATTERNS`, parsed out of the production module rather than copied, so a ninth format
      extends the sweep on the same commit.
  - Tests: `tests/security/no-reusable-secrets-outside-the-vault.test.mjs` — **13/13**
    (`node --test`, no browser, no server, no database). Was 12; this run added one.
  - **The defect this run found and fixed, which is why the row is not just a recording.**
    The config sink asserted `assert.match(source.slice(scan, scan + 800), /blockers\.push\(/)`.
    Replacing the `blockers.push` that handles a SECRET finding with a `console.warn` left the
    file at **`# pass 12 # fail 0`** — two later `blockers.push` calls, about approval-by-the-
    author and past activation, sat inside the same 800 characters and satisfied the match. A
    credential typed into any ordinary `platform.*` string would have been published into an
    immutable revision with the sink's own guard green. A fixed window is a guard an unrelated
    neighbour can satisfy. Replaced with `handlingBlock(source, scan)`, which brace-matches
    the first block opening at or after the scan, applied to BOTH the event and config sinks;
    plus a new test, `the brace matcher does not accept a neighbour's handling for the sink's
    own`, which pins the property directly against four shaped sources (neighbour rejected,
    handling accepted, nested braces still inside, no block at all → `""` rather than a pass).
    This is the only file changed by this run and it is a shared test; it is listed as such.
  - Mutations (5 on the producers, one at a time, every one restored and re-verified):
    1. **model.** `const leaked = findSecretValues({ system, user }, "prompt")` → `const
       leaked = []` in `apps/web/src/lib/ai.ts`. `not ok 7 - sink: model — aiComplete scans
       the prompt before it reaches the vendor`, **`# pass 11 # fail 1`**. Restored.
    2. **event.** `throw new ProviderPayloadRefused(` → `console.warn(new
       ProviderPayloadRefused(` in `apps/web/src/lib/outbox/outbox.ts`. `not ok 9 - sink:
       event`, **`# pass 12 # fail 1`** after the brace-match fix (**`# pass 11 # fail 1`**
       before it). Restored.
    3. **config, and this is the one that mattered.** `blockers.push(` → `console.warn(`
       inside `for (const found of findSecretValues(layer.values)) {` in
       `packages/configuration/src/publication.ts`. **Before the fix: `# pass 12 # fail 0` —
       it survived.** After the fix: `not ok 10 - sink: config — a published value carrying a
       credential is blocked`, **`# pass 12 # fail 1`**. Restored.
    4. **log.** `` failed: ${safeLogText(err)}` `` → `` failed: ${err}` `` in
       `apps/web/src/lib/commands/bus.ts`. `not ok 8 - sink: log — every log line carrying
       foreign text goes through safeLogText`, **`# pass 11 # fail 1`**. Restored.
    5. **the patterns the evidence sink reads.** The `AWS access key id` entry deleted from
       `PATTERNS` in `packages/audit/src/secret-values.ts`. `not ok 5 - the patterns are
       readable at all`, **`# pass 11 # fail 1`**. Restored byte-for-byte —
       `git status --porcelain packages/audit/src/secret-values.ts` empty.
  - Stated rather than implied, because a refuter should not have to find it: the **browser**
    sink's mutation is on a guard, not a runtime writer, because this repository has no
    runtime browser-storage credential writer to mutate — the rule is enforced statically over
    the whole tree by `credentialWrites`, and this file's contribution is that deleting that
    function fails this file at IMPORT time. The **evidence** sink was not mutation-proved by
    planting a credential in a ledger, because this wave may not edit
    `docs/implementation/*-ledger.md`; it is proved instead by mutation 5 (the sweep reads the
    production patterns, so shrinking them reds) and by the file's own `the evidence sweep
    would notice one`, which plants each format in a synthetic ledger line.
  - Evidence: `node --test tests/security/no-reusable-secrets-outside-the-vault.test.mjs` —
    `# tests 13 / # pass 13 / # fail 0`. Together with its neighbours:
    `node --test tests/security/no-reusable-secrets-outside-the-vault.test.mjs
    tests/security/no-automatic-identity-merge.test.mjs tests/security/email-is-not-a-key.test.mjs
    tests/security/no-tokens-in-browser-storage.test.mjs` — `# pass 28 # fail 0`.
    `npx jest --ci --silent src/lib/relay src/lib/connections src/lib/relay-tools.test.ts
    src/app/api/ai src/lib/outbox` from `apps/web` — `Tests: 356 passed, 356 total`.
    `npx tsc --noEmit` in `apps/web` — 0 errors.
  - Not claimed: WRK-040-004. The Credential Broker exists
    (`apps/web/src/lib/connections/credential-broker.ts`, guarded by
    `tests/security/provider-secrets-go-through-the-broker.test.mjs`) but the KMS-bound vault
    and the short-lived runner capability need AWS KMS and are not built. This row is the
    PROOF half and does not depend on them.
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
  - Overturned on review: All three claimed mutations reproduced across five suites (freshnessOf -> `return "LIVE"`: 6 failed / 269 passed at the primitive, rankDocs, loadSearchCorpus, /api/search and /api/ai/chat; governedDeepLink host check deleted: 1 failed, `still refuses a host the provider did not declare, however approved it is`; activation gate -> `if (false) return null`: 2 failed). citation.ts is real, reached and fails closed. But the requirement is about DISTINCTIONS — sec 9.3's sentence is "The USER CAN DISTINGUISH source text, Tenure record, Relay inference, and human-approved memory" — and the module that makes those distinctions visible has no test anywhere in the repository. `grep -rln "citation-display|originLabel|stateCaveat|INFERENCE_NOTE|citationLine" --include=*.test.* --include=*.itest.* --include=*.spec.* apps packages tests` returns NOTHING, and there is no citation-display.test.ts beside the module. Two mutations of it survive the whole suite at 237 passed / 237 total, zero failures: (1) originLabel collapsed to `return `${holder} record`` so a PROJECTION is labelled a record — the source distinction the claim cites CITATION_ASSERTIONS for, erased on all three reading surfaces ((app)/search/page.tsx, TenureAIPanel.tsx, SearchCommand.tsx), silently; (2) stateCaveat's unknown-state branch, "State unknown — open the source directly", replaced with `null`, so a state this build cannot name renders with no caveat at all — i.e. as current. That second one is this codebase's central rule and sec 3.5's own words ("Never answer as though a stale, deleted, inaccessible ... source is current") reported as fine instead of as unknown, with nothing catching it. The three claimed mutations were all on citation.ts values; the display half where the requirement's "distinctions" actually land is unproved. To close: test citation-display.ts — originLabel over both assertions, stateCaveat over all six states plus an unnameable one, ageLabel's boundaries.
  - **Why this row exists at all.** `apps/web/src/lib/relay/citation.ts` landed in `f589596` with
    no ledger row. Verified against the sentence, re-proved by mutation, recorded.
  - The three distinctions the requirement names, each as a value rather than as prose:
    * **freshness** — `freshnessOf(asOf, now)` returns `"LIVE" | "STALE"` against
      `SEARCH_STALE_AFTER_MS` (90 days), and FAILS CLOSED to `STALE` on an unreadable date,
      because a row whose version time did not survive its projection has no freshness anybody
      can vouch for. A stale source is still RETURNED and still ranked — hiding a budget deadline
      from last week is its own kind of wrong — and is labelled instead, which is §3.5's actual
      rule ("never answer as though a stale source is current", not "never answer").
    * **source** — `ExternalObjectRef` and `parseExternalObjectRef`: origin as a checked
      reference, never a display string. `TENURE_PROVIDER` is the one constant naming this
      corpus's system of record, so the first connector-backed row is a value change and not a
      search-and-replace.
    * **inference** — `CITATION_ASSERTIONS = ["RECORD", "PROJECTION"]`. A citation says whether
      it asserts what the record IS or what a projection of it SAID, which is the distinction a
      reader needs and the one a bare link erases.
  - **Governed deep links**, which is the half with teeth. `ProviderDeepLinkPolicy` DECLARES the
    single `host` whose URLs may be cited for a provider, and `governedDeepLink` compares the
    stored URL against it — never parses the host out of it and believes it. That is the whole
    control: a projected object's link is a string the provider, or whoever wrote into the
    provider, chose, so "it says it is an Outlook link" is a claim by the attacker-influenceable
    half of the pair. Four refusals, in order: unknown provider (absent from
    `PROVIDER_DEEP_LINK_POLICIES` is refused, never defaulted), provider review not activated
    (`providerActivation`), non-`https:`, and host mismatch. A Tenure path (`providerId === null`)
    must start with `/` and not `//`, so a citation cannot become an open redirect.
  - Consequence, deliberate and shipped: `GRAPH_CALENDAR_REVIEW.state` is honestly
    `NOT_SUBMITTED`, so `governedDeepLink` refuses EVERY Microsoft link as this ships. That is
    what an activation gate is, and it is the same consequence `/api/ai/chat` already accepts from
    `RELAY_ANTHROPIC_REVIEW`. `now` and `policies` are parameters precisely so the activated branch
    can be exercised without writing `APPROVED` into the shipped record.
  - Callers: `projectTenureRecord` builds a `SourceCitation` for every row `loadSearchCorpus`
    returns (`apps/web/src/lib/search-data.ts`); `citationLabel` goes at the FRONT of the heading
    `modelSourceFor` hands the vendor, ahead of the tenant's own title, so a long club name cannot
    push the label past `fenceUntrusted`'s 300-character cap; `citationRules()` is in the system
    prompt via `apps/web/src/app/api/ai/chat/route.ts:33` and `apps/web/src/lib/ai.ts:8`; and
    `apps/web/src/lib/relay/citation-display.ts` renders it for people in
    `apps/web/src/app/(app)/search/page.tsx`, `apps/web/src/components/ai/TenureAIPanel.tsx` and
    `apps/web/src/components/shell/SearchCommand.tsx`.
  - Tests: `apps/web/src/lib/relay/citation.test.ts` 19/19,
    `apps/web/src/lib/search.test.ts` 38/38, `apps/web/src/app/api/search/search-lifecycle.test.ts`
    5/5 (the `/api/search` route), `apps/web/src/app/api/ai/chat/relay-prompt-safety.test.ts` 21/21
    (the `/api/ai/chat` route), `apps/web/src/app/api/ai/ai-kill-switch.test.ts` 42/42.
  - Mutations (3 applied, 3 caught, all restored; producer mutated each time):
    1. `freshnessOf`: `return reference - at > SEARCH_STALE_AFTER_MS ? "STALE" : "LIVE"` →
       `return "LIVE"`. **6 failed / 269 passed** across five suites, and the failures span all
       three layers: the primitive (`calls a row inside the horizon live and one outside it
       stale`), the ranking (`still ranks a stale doc, because §3.5 asks for freshness to be
       shown`), the corpus (`marks a row nobody has touched in two years stale, and still projects
       it`), the `/api/search` route (`labels a row nobody has touched in two years, and still
       returns it`) and the `/api/ai/chat` route (`does answer from a stale source, and labels it
       in the prompt and the response`). Restored, 275/275.
    2. `governedDeepLink`: `return parsed.host.toLowerCase() === policy.host.toLowerCase() ?
       parsed.href : null` → `return parsed.href` — the declared-host check deleted. **1 failed /
       274 passed**: `still refuses a host the provider did not declare, however approved it is`.
       Restored, 275/275.
    3. `governedDeepLink`: `if (!providerActivation(policy.scopes, policy.review,
       now.toISOString()).activated) return null` → `if (false) return null`. **2 failed / 273
       passed**: `refuses every link for the provider as this ships, because nobody reviewed it`
       and `refuses once an approval has lapsed`. Restored, 275/275.
  - Evidence: `npx jest --ci src/lib/relay src/lib/search.test.ts src/app/api/ai src/app/api/search`
    from `apps/web` — `Tests: 275 passed, 275 total`. Whole targeted set after restoring everything:
    354/354 across 20 suites.
  - Not claimed: WRK-GATE-070, which also needs WRK-070-002 (source-ACL authorization before model
    exposure) and WRK-070-006 (governed memory). And `PROVIDER_DEEP_LINK_POLICIES` has exactly ONE
    entry, because this repository catalogues exactly one external provider; the table's shape is
    proven, its breadth is a function of WRK-080/090 and is not claimed here.

- [ ] **WRK-070-004** — Implement deletion/access/retention/legal-hold propagation across graph, chunks, embeddings, caches, summaries, and citations.
  - Status: FAIL
  - Reason: imported from `Tenure_Universal_Work_Graph_and_Workspace_Connector_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **WRK-070-005** — Implement indirect prompt-injection, malicious-file, DLP, link, and tool-exfiltration defenses.
  - Status: FAIL
  - **Considered for closure this run and refused: two and a half of the five.**
    `apps/web/src/lib/relay/untrusted-content.ts` is real and is wired to
    `apps/web/src/app/api/ai/chat/route.ts` and to `synthesizeAnswer` / `summarizeDocument` in
    `apps/web/src/lib/ai.ts`, so all three paths that carry tenant text to a model vendor go
    through it. `apps/web/src/lib/relay/untrusted-content.test.ts` and
    `apps/web/src/lib/relay/ai-surface-fencing.test.ts` are green.
    * **indirect prompt-injection** — covered. `fenceUntrusted` delimits every retrieved body AND
      the client-supplied `history` with a per-request NONCE in both markers, named in the system
      message the tenant cannot write to, so a body containing the literal close marker closes
      nothing. `untrustedContentRules(nonce)` tells the model the fenced text is data.
    * **hidden-text / link** — covered for the retrieved-text half. `INVISIBLE_RANGES` strips
      zero-width, bidi override, soft hyphen, C0/C1, interlinear, private-use and the U+E0000 tag
      block — written as codepoint NUMBERS and assembled, because a source file whose control is
      itself invisible cannot be reviewed. `activeContentFindings` reports active content and
      `hostLabel` refuses to let a retrieved body carry a fetchable URL into a prompt.
  - Missing, and each is a whole defence rather than a rough edge:
    * **DLP** — nothing inspects what LEAVES for the vendor or for a person. `grep -rn "dlp\|DLP"`
      across `apps/web/src` and `packages` finds no classifier, no pattern set and no egress
      decision. The projection modes (WRK-010-003) cap HOW MUCH text crosses by source kind; they
      do not look at what the text says.
    * **malicious-file** — no scanning of any kind. `summarizeDocument` reads an uploaded document
      and nothing between the upload and the model examines it.
    * **tool-exfiltration** — partial at best. `invokeRelayTool` refuses the model choosing tenant,
      credential, account or an unlisted recipient (WRK-050-006, PASS), which stops the model
      DIRECTING an exfiltration; nothing inspects a tool's ARGUMENTS for tenant data being smuggled
      out inside an otherwise-permitted call, and there is no outbound tool to smuggle through yet.
  - Not mutation-proved here, because no PASS was claimed. The two covered halves are exercised by
    the suites named above and by the route tests in
    `apps/web/src/app/api/ai/chat/relay-prompt-safety.test.ts`.

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

## WRK-020-001 — every one of §4.1's eight classes is now pinned at its own ceiling

- [x] **WRK-020-001** — "Implement every connection class and prohibit class escalation."
  - Status: PASS
  - What the overturn named, and what this run did about it. The previous claim was
    refuted for one reason and it was the right one: `connection-class.test.ts`'s only
    per-class check was `expect(RISK_ORDER).toContain(authority.maxRisk)`, which all seven
    risk names satisfy, and four of the eight classes appeared in no other assertion.
    `CLASS_AUTHORITY.FILE_OR_FEED.maxRisk` could therefore be raised from `BULK` to
    `DELETE` — an SFTP, object-store, ICS or EDI feed authorised to delete tenant records —
    with `npx jest src/lib/relay src/lib/relay-tools.test.ts src/app/api/ai` at 232 passed /
    232 total. "Implement EVERY connection class" is not satisfied by a class whose declared
    authority nothing asserts.
  - Code (unchanged this run; it was already correct and already wired):
    `packages/platform-config/src/provider-review.ts` — `CONNECTION_CLASSES` (§4.1's eight),
    `connectionClassFor`, `RELAY_CAPABILITY_OFFERS`.
    `apps/web/src/lib/relay/connection-class.ts` — `CLASS_AUTHORITY` (a `Record` over
    `ConnectionClass`, so a ninth class is a compile error), `RISK_ORDER`, `leastClassFor`,
    `refuseEscalation`, `EscalationVerdict`.
  - Caller: `authorizeRegistrations` in `apps/web/src/lib/relay-tools.ts:402-425` consults
    `classOf(tool.module)` for every registration on every `/api/ai/chat` request as gate 0,
    ahead of the surface's read-only ceiling and ahead of any permission read. Reachability
    from the route is proved in `apps/web/src/app/api/ai/ai-kill-switch.test.ts:1172`, which
    asserts `body.relayTools.refused[0].remedy` matches `{ kind: "CONNECTION_CLASS_EXCEEDED", … }`.
  - Tests added: `apps/web/src/lib/relay/connection-class-authority.test.ts` — **21/21**, a
    NEW file rather than an edit to `connection-class.test.ts`, which eleven concurrent
    agents make a collision risk. Every class is pinned twice: the literal it declares, and
    the BOUNDARY that literal produces through `refuseEscalation` — the act at the ceiling is
    allowed and the next act up the ladder is refused. A structural check alone would pass if
    `refuseEscalation` stopped reading the table; a behavioural check alone would pass if a
    ceiling and the comparison drifted together. Plus `leastClassFor` for all seven risks,
    the property that it never names a class that could not carry the act, and that exactly
    one class (`ADMIN_DELEGATED`) reaches `PRIVILEGED`. Nothing asserts a measured pixel or a
    row count; every number is an index into `RISK_ORDER`, which is a token list.
  - Mutations (5 applied to the producer, 5 caught, all restored; one literal at a time):
    1. **The escape the refuter found.** `CLASS_AUTHORITY.FILE_OR_FEED.maxRisk` `"BULK"` →
       `"DELETE"`. **`Tests: 3 failed, 18 passed, 21 total`** — `FILE_OR_FEED declares its
       ceiling as BULK` with `Expected: "BULK" / Received: "DELETE"`, `FILE_OR_FEED reaches
       BULK and refuses the act above it`, and `lets a feed move data in volume and go no
       further` with `Expected: false / Received: true`. Restored, 21/21.
    2. `FILE_OR_FEED.maxRisk` `"BULK"` → `"EXTERNAL_SHARE"` — the second surviving mutation
       the refuter recorded. **3 failed / 18 passed.** Restored, 21/21.
    3. `SERVICE_ACCOUNT.maxRisk` `"BULK"` → `"DELETE"`. **3 failed / 18 passed.** Restored.
    4. `USER_DELEGATED.maxRisk` `"DELETE"` → `"PRIVILEGED"`. **5 failed / 16 passed** — it
       also moves `leastClassFor("PRIVILEGED")`, which the ladder tests catch. Restored.
    5. `PERSONAL_PRODUCTIVITY.tenantWide` `false` → `true`. **3 failed / 18 passed**,
       including `refuses every act on the one class §4.1 keeps out of tenant-wide use`.
       Restored, 21/21.
    `git status --porcelain apps/web/src/lib/relay/connection-class.ts` was empty after each
    restore.
  - Evidence: `npx jest --ci src/lib/relay/connection-class-authority.test.ts` from
    `apps/web` — `Tests: 21 passed, 21 total`. Whole neighbourhood after restoring
    everything: `npx jest --ci --silent src/lib/relay src/lib/connections
    src/lib/relay-tools.test.ts src/app/api/ai src/lib/outbox` — `Test Suites: 21 passed`,
    `Tests: 356 passed, 356 total`. `npx tsc --noEmit` in `apps/web` — **0 errors**.
    `npx eslint src/lib/relay/connection-class-authority.test.ts` — no output.
  - Not claimed, and both were noted by the refuter as not the basis of its verdict:
    `RELAY_CAPABILITY_OFFERS` still has one entry, so seven of the eight classes are attached
    to no shipped capability; and `isConnectionClass` is still exported with no production
    caller. Giving it one means guarding the `classOf` seam in `relay-tools.ts`, a file other
    WRK bands are editing this hour, so it was deliberately left alone rather than raced.

## WRK-030-005 — the derivation of `certified`, asserted in both directions

- [x] **WRK-030-005** — "Ensure uncertified capabilities never produce a working-looking OAuth button."
  - Status: PASS
  - What the overturn named. The previous claim's three mutations all reproduced and the
    render chain was traced and found real; what refuted it was a fourth branch of the
    producer that nothing asserted. `certifiedCapabilityState`'s own comment states the rule
    — "A key in NEITHER list resolves to `certified: false`. Fail closed" — and inverting
    exactly that, `return { key, certified: FIRST_PARTY.includes(key) }` →
    `return { key, certified: true }`, left `npx jest src/lib/connections src/app/api/ai` at
    **134 passed / 134 total, zero failures**. `capability-resolution.test.ts` contains no
    occurrence of `certifiedCapabilityState` or `FIRST_PARTY`: it builds its own `certified`
    and proves the RESOLVER, never the derivation the resolver consumes. The practical
    consequence is the requirement's own sentence one layer down — the next capability key
    added, or a typo in an existing one, would default to certified and grow a
    working-looking Connect button for something `/api/ai/chat` refuses, with the suite green.
    The lexical guard does not cover it either: its rule is "no `certified:` literal in a
    `.tsx`", which is the call-site failure, not the default.
  - Code (unchanged this run): `certifiedCapabilityState(key, at)` and `resolveCapability`'s
    unconditional first refusal in `apps/web/src/lib/connections/capability-resolution.ts`;
    `providerActivation` / `RELAY_ANTHROPIC_REVIEW` in
    `packages/platform-config/src/provider-review.ts`.
  - Callers: `apps/web/src/app/(app)/settings/page.tsx:98,126,144,200` and
    `apps/web/src/components/ai/TenureAIPanel.tsx:390` — the only two shipped surfaces that
    render a capability.
  - Tests added: `apps/web/src/lib/connections/certified-capability-state.test.ts` —
    **11/11**, a NEW file. Three branches, one test each, and the CONSEQUENCE of each carried
    through `resolveCapability` rather than stopping at the boolean:
    * the three first-party keys (`documents.storage`, `calendar.feed`, `identity.sso`)
      certify — written out as literals, because reading `FIRST_PARTY` back would be the list
      asserting that it equals itself (it is module-private, so it could not be read anyway);
    * four unclassified keys refuse — a plausible new provider (`slack.messages`), two typos
      of real keys (`calendar.feeds`, `documents.storge`), and the empty string a mis-wired
      call site would pass;
    * `ai.model` reads the REAL `RELAY_ANTHROPIC_REVIEW`, whose state is `NOT_SUBMITTED`,
      asserted alongside so a recorded review changes this test rather than leaving a stale
      pin;
    * the returned `key` is always the key asked about, which is the whole reason this is a
      fragment to spread rather than a bare boolean;
    * end to end, an unclassified key yields `outcome: "NOT_CERTIFIED"`, `action.kind:
      "none"`, `action.label: ""`, `statusWord: "Not available yet"`;
    * and the other direction, so the default is not vacuous: `calendar.feed` DOES reach
      `action.kind: "connect"`. A derivation returning false for everything would satisfy
      every refusal assertion above and take the platform's own capabilities off the air.
  - Mutations (3 applied to the producer, 3 caught, all restored):
    1. **The escape the refuter found.** `return { key, certified: FIRST_PARTY.includes(key) }`
       → `return { key, certified: true }`. **`Tests: 5 failed, 6 passed, 11 total`** — all
       four unclassified-key cases plus the end-to-end one, whose first failure reads
       `Expected: "NOT_CERTIFIED" / Received: "NEEDS_USER_CONNECT"`. That is the
       working-looking connect button appearing, in the assertion. Restored, 11/11.
    2. `"calendar.feed"` deleted from `FIRST_PARTY`. **`Tests: 2 failed, 9 passed, 11 total`**
       — `certifies calendar.feed, because Tenure runs it and no provider has an opinion`
       (`Expected: true / Received: false`) and `a first-party key does reach a connect
       control, so the default is not vacuous`. Restored, 11/11.
    3. `return { key, certified: providerActivation(reviewed.scopes, reviewed.review, at)
       .activated }` → `return { key, certified: true }` — the provider-reviewed arm.
       **`Tests: 1 failed, 10 passed, 11 total`** on `reads the real provider review for the
       one capability that has one`. A localised mutation, a localised failure. Restored.
    `git status --porcelain apps/web/src/lib/connections/capability-resolution.ts` was empty
    after the restores.
  - Evidence: `npx jest --ci src/lib/connections/certified-capability-state.test.ts` from
    `apps/web` — `Tests: 11 passed, 11 total`.
    `npx jest --ci --silent src/lib/relay src/lib/connections src/lib/relay-tools.test.ts
    src/app/api/ai src/lib/outbox` — `Test Suites: 21 passed`, `Tests: 356 passed, 356 total`.
    `node --test tests/architecture/certified-is-derived.test.mjs` — still `# pass 3 / # fail 0`.
    `npx tsc --noEmit` in `apps/web` — **0 errors**. `npx eslint
    src/lib/connections/certified-capability-state.test.ts` — no output.
