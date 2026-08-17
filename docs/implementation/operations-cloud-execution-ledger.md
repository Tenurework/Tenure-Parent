# Operations, Supply, Manufacturing and Service Cloud — execution ledger

Every `OPS-*` requirement stated by `Tenure_Operations_Supply_Manufacturing_and_Service_Cloud_Claude_Bible_v1.0.md`.

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

- [x] **OPS-000-001** — Inventory current operations/inventory/project/event code and false claims.
  - Status: PASS
  - Code: `tools/ops-operations-inventory.mjs` — the generator
    (`canonicalEntities`, `schemaDeclarations`, `sourceFiles`, `vocabularyHits`,
    `collisionProblems`, `verdictProblems`, `build`);
    `docs/architecture/ops-operations-code-inventory.md` — its output, 201 lines;
    `tests/architecture/ops-operations-inventory.test.mjs` — the guard, which
    re-derives every row and compares.
  - What it found, all of it derived rather than asserted:
    1. **The schema has none of it.** Bible §2 "Shared operational model" names
       **79** distinct canonical entities, parsed from that section's own
       backticked identifiers. `apps/web/prisma/schema.prisma` declares **76**
       models and enums. **76 of the 79** have no declaration of that name at
       all — no `Product`, `Item`, `UnitOfMeasure`, `Site`, `Warehouse`,
       `InventoryBalance`, `WorkOrder`, `Project`, `ServiceCase`, `Asset`.
    2. **The three that share a name are not the entity.** `Deliverable` is a
       compliance deadline on a board seat; `Delivery` is the record that one
       message reached one participant on one channel; `Resource` is a board
       resource — a form, guide, policy, tool or checklist. This is the finding
       a bare coverage count would have hidden: a reader skimming for
       `Resource` sees a canonical name and stops. Each row quotes a literal
       substring of the schema, checked by the generator, so the description
       cannot drift from the declaration it describes.
    3. **No false Operations claim exists to withdraw.** The tenant product
       (`apps/web/src`, `modules`, `packages`) was scanned for 22 Operations
       terms: **31** matches in **17** files, and every one is a different
       sense of the word — the design-token inventory, an institution's
       procurement timetable for Okta, a `logistics` department in an
       org-topology fixture, the device/session inventory of Bible §21.2, a
       `key: "procurement"` manifest the catalog exists to refuse. **0 of 17**
       are Operations capability claims. The finding is an absence, not an
       overstatement, and that is worth writing down precisely because it is
       the answer somebody would otherwise assume without looking.
  - Why a generator and not a list: a hand-written inventory is stale the day
    after it is written and indistinguishable from one assembled out of the
    Bible's own wording. Every row here comes from a file that exists, and the
    guard rebuilds all of it and demands byte equality. The authored parts (the
    word-sense verdicts, the collision notes) cannot rot either: `build()`
    refuses to emit when a scanned file has no verdict, when a verdict names a
    file the scan no longer matches, or when a collision's quoted evidence is
    not in the schema.
  - Determinism: directories are read and sorted with a codepoint comparator,
    paths are emitted POSIX-separated, every file is read as utf8 and normalised
    to LF before it is parsed, and nothing reads a clock, a hash of raw bytes or
    git. `node --test … --test-name-pattern="stable when run twice"` asserts it.
  - Tests: `node --test tests/architecture/ops-operations-inventory.test.mjs`
    → **11/11**. Two of the eleven exercise the generator's refusals directly
    against synthetic input, so a detector that returned `[]` for everything
    fails here rather than leaving `build()` looking identical and checking
    nothing. Four are floors — 70+ entities, 60+ declarations, 20+ product
    matches, 50+ operator-plane matches — because every other assertion in the
    file passes trivially against an empty scan, and an empty scan reports
    exactly the conclusion the document draws.
  - Mutations: **5 applied, 5 caught, all restored**, verified green after each.
    1. Deleted the row `| \`WorkOrder\` | absent |` from the document →
       `not ok 5 — the committed inventory is what the tree says today`;
       restored → 10/10.
    2. Rewrote a cited path to `packages/organization-model/src/warehouse-topology.ts`
       → 2 red, including `every repository path the inventory cites is a path
       that exists`; restored → 10/10.
    3. Changed an absence row from `` `Warehouse` `` to `` `Event` ``, a model the
       schema does declare → `not ok 6 — every entity the inventory calls absent
       really is absent from the schema`; restored.
    4. Removed the `packages/organization-model/src/topology.ts` verdict from
       `VERDICTS` → the generator threw ``… uses Operations vocabulary and has
       no verdict in VERDICTS`` and 2 tests red; restored → 11/11.
    5. Replaced the `Resource` collision's quoted schema evidence with invented
       text → generator threw ``The evidence quoted for `Resource` is not in
       apps/web/prisma/schema.prisma``, 2 tests red; restored → 11/11.
    No mutation stub was left behind: `grep -rn "MUTATION"` over the generator,
    the guard and the document returns nothing.
  - Honest limits, so the next reader does not over-read this:
    * The scan covers `.ts`/`.tsx` under the three product roots. A false
      Operations claim in marketing copy, a `.md`, a Terraform file or a
      blueprint would not be caught by it.
    * `apps/system-studio/src` is excluded by scope and by argument — its
      Operations vocabulary is the AWS estate sense, `apps/system-studio/src/lib/aws/inventory.ts`
      being the module that lists AWS resources. Its match count is
      deliberately NOT committed: it is in the hundreds and moves with work
      belonging to other domains, and a number in a committed file that
      somebody else's commit invalidates is a stale artefact waiting to happen.
      The guard holds it to a floor of 50 and asserts that named file is still
      matched, so the exclusion cannot quietly become an empty scan.
    * The generator is not wired into `npm run generate`, because `package.json`
      is shared and was not editable in this wave. Until it is, a change to the
      scanned surface makes the document stale and the guard red — with the
      exact command in the failure message. Adding
      `node tools/ops-operations-inventory.mjs` to that script is the follow-up.
    * The word-sense verdicts are authored judgements. What is mechanical is
      that every scanned file has one and every judgement has a file.
  - **2026-08-17, the tripwire fired three times in one session, which is the
    evidence that it is one.** The counts above moved from 27/14 to 31/17
    because three other domains added files during this wave and every one of
    them says `inventory`:
    `apps/web/src/lib/people/seat-memory-boundary.ts`,
    `packages/finops/src/general-ledger.ts` and
    `apps/web/src/lib/planning/spread.ts`. All three cite their own domain's
    derived inventory document — `hcm-people-inventory.md`,
    `fin-finance-surface-inventory.md`, `pln-planning-inventory.md` — so all
    three are `unrelated-word`, and each now carries that verdict with the
    document it cites named. `node --test tests/architecture/ops-operations-inventory.test.mjs`
    → **11/11** after regenerating; it was **9/11** before, failing on
    ``… uses Operations vocabulary and has no verdict in VERDICTS`` with the
    exact paths. Two things follow, and the second is the useful one:
    1. the generator's refusal works against real drift by other people, not
       only against synthetic input in its guard, and
    2. this guard is red for whoever runs it next any time a domain adds a file
       containing one of the 22 terms, until an Operations reader judges the
       word. That is the intended cost. It is also why wiring
       `node tools/ops-operations-inventory.mjs` into `npm run generate` matters
       more than it looked: `package.json` is still shared and still not
       editable in a twelve-agent wave, so the regeneration is manual and the
       failure message is the only thing that carries the instruction.

- [ ] **OPS-000-002** — Implement shared product/site/item/UOM/order/supply/inventory/work/asset/project/service models.
  - Status: BLOCKED_EXTERNAL
  - Reason: every one of the 76 absent entities recorded by `OPS-000-001` is a
    tenant-owned table, so the whole requirement lands in
    `apps/web/prisma/schema.prisma` and a migration beside it. That file is
    shared across all seventeen domains and was explicitly out of bounds for
    this wave; editing it here would have produced a merge conflict that costs
    another agent more than this requirement is worth.
  - Second, independent leg — and the one that would still stand with the file
    in hand. `docs/architecture/REVIEW-FINDINGS.md` P0 #8 records **three
    mutually exclusive target schemas, all marked MVP** (`Role`→`Seat` with
    `@@map`; the `org_unit`/`position`/`principal` snake-case rewrite with
    composite `(tenant_id, id)` PKs; and "do not rename"), and
    `docs/decisions/ADR-0004-tenant-scoped-schema.md` is still **Status:
    Proposed — five product decisions outstanding**. Adding 76 tenant-owned
    tables before that is settled means picking one of the three by accident
    and rewriting all 76 when it is settled deliberately. REVIEW-FINDINGS
    overrides the architecture document, and it says the naming/PK question is
    open.
  - What unblocks it, precisely:
    1. A wave in which the Operations agent holds `apps/web/prisma/schema.prisma`
       exclusively, and
    2. ADR-0004 moved off `Proposed` — or a new ADR that answers only the part
       Operations needs: whether new tenant-owned aggregates take `institutionId`
       + cuid like the 15 models that already carry it, or the composite
       `(tenant_id, id)` shape the hierarchy section specifies. Then
       `npm exec --workspace apps/web -- prisma migrate dev --name ops-foundation`
       and `npm run db:migrate`.
  - Not blocked on: knowing what to build. `docs/architecture/ops-operations-code-inventory.md`
    §1 is the entity list, derived from Bible §2, with the three name collisions
    called out so they are not mistaken for coverage.

- [ ] **OPS-000-003** — Implement state machines, idempotency, concurrency and operational event contracts.
  - Status: BLOCKED_EXTERNAL
  - Reason: transitively blocked by `OPS-000-002` for the state-machine and
    concurrency halves — there is nothing to sequence or to lock until the
    entities exist — and blocked on a second shared file for the contracts
    half. Operational event and idempotency contracts belong beside
    `DomainEvent`, `OutboxRecord`, `IdempotencyRecord` and `isEventType`, which
    all live in the single 1,701-line `packages/contracts/src/index.ts`. That
    one file is what the Integration, Pack Factory and Catalog domains extend
    too, and `INT-000-003` and `PACK-000-003` were in the same queue slice as
    this item.
  - The specific hazard, not just the file name: `isEventType` gates which
    event types the platform accepts, and widening it is a type change whose
    construction sites are spread across the workspace. An optional field a
    caller omits is invisible to `tsc`, which is how a widening lands green and
    breaks a consumer — so this edit needs one agent holding the file and
    naming every construction site, not two agents merging.
  - What unblocks it: `OPS-000-002` first, then a wave in which the Operations
    agent holds `packages/contracts/src/index.ts` exclusively. New audit writes
    from the resulting state machines go through `recordAuditEvent`
    (`apps/web/src/lib/audit-record.ts:470`), which already exists — that part
    is not blocked and is not new machinery.
  - Not blocked on: the transport. `apps/web/prisma/schema.prisma` already
    declares `model OutboxEvent` and `model InboxEvent`, so the event half is a
    contract over machinery that is already there. The guard
    `tests/architecture/ops-operations-inventory.test.mjs` asserts both models
    still exist, so this sentence cannot go stale unnoticed.

- [ ] **OPS-000-004** — Import every `OPS-*` item into the canonical ledger.
  - Status: FAIL
  - Overturned on review: Import itself is real and both claimed mutations reproduce exactly: baseline 6/6; renaming the ledger row OPS-030-004 -> OPS-030-999 gave `not ok 2` AND `not ok 3`, 4/6; duplicating the OPS-GATE-050 row gave `not ok 3`, 5/6; 6/6 after each restore. The Bible states 32 OPS ids (5+5+5+5+6+6 across sections 24's six groups) and the ledger carries 32 rows, so the requirement's own sentence is met. REFUTED on the fourth assertion, which the claim calls merely 'not proven by mutation' but which is actually broken: `ledgerStatuses()` (tools/document-graph.mjs:419-470) does `status.set(id, ...)` over `readdirSync(dir).sort()`, so the OPS ledger's own row OVERWRITES any misfiled duplicate in a ledger whose filename sorts earlier. I proved it in an isolated copy of tools/+docs/+the Bibles (ROOT is derived from the module path, so a copy is a faithful harness): appending `- [x] **OPS-030-002** / Status: PASS` to docs/implementation/analytics-reporting-execution-ledger.md left the suite at 6/6 with the misfiled PASS invisible, while the identical row in planning-epm-execution-ledger.md produced `not ok 4`. 8 of the 15 other ledgers (analytics-reporting, connection-composer, declarative-configurator, erp-pack-factory, financial-management, global-engine, identity-eligibility-entitlement, integration-ecosystem) sort before `operations-` and are therefore blind, and blind in the direction that matters — a wrongly-filed PASS. The ledger row states as fact 'none is filed in another domain's ledger'; today that is true (I grepped: no OPS row exists outside the OPS ledger), but the guard cannot keep it true. Fix is small: compare per-file id sets rather than reading a last-writer-wins Map.
  - Code: `tests/architecture/ops-requirements-are-imported.test.mjs` — the guard
    (`ledgerIds`, plus five assertions over `requirementsIn`, `ledgerStatuses`
    and `buildRegistry` from `tools/document-graph.mjs`). No new production
    module: the import itself was done by `tools/import-requirements.mjs`, and
    what was missing was anything that could tell whether it stayed done.
  - Caller: `tools/run-platform-tests.mjs` discovers every `tests/**/*.test.mjs`
    from the filesystem (`discover()`, line 27) and runs them, so this file is in
    `npm run test:platform` — which is in `npm run verify` and in CI — from the
    commit that adds it, with nothing to register it in.
  - Tests: `node --test tests/architecture/ops-requirements-are-imported.test.mjs`
    → **6/6**, 0.19s. The state it records: the Bible states **32** `OPS-*`
    requirements, the ledger carries **32** rows, no id is missing, none is
    invented, none is repeated, none is filed in another domain's ledger, and the
    generated registry owns exactly those 32 and resolves every one back to the
    Bible at its canonical path.
  - Why this is not what `document-graph.test.mjs` already does: that ratchet
    counts requirements reaching NO execution document, and `importedIds()` is a
    **union** over every `*-ledger.md`. An `OPS-*` row filed in the planning
    ledger is therefore "imported", the global count is unchanged, and the domain
    that owns it has no row to work. It also looks in one direction only, so an
    invented `OPS-060-001` would inflate a denominator nobody re-derives, and it
    does not notice a duplicate — which is not theoretical:
    `a-ticked-box-is-a-passing-requirement.test.mjs` exists because
    `STUDIO-030-003` carried three rows and was ticked on the strength of one.
    This compares the two sets in both directions and pins the count.
  - Mutations: **2 applied, 2 caught, both restored**, green after each. Both on
    the ledger itself, which is this requirement's subject matter — a mutation to
    the test would prove nothing about the import.
    1. Renamed the row `**OPS-030-004**` to `**OPS-030-999**` →
       `not ok 2 — every OPS requirement the Bible states has a row in the
       Operations ledger` AND `not ok 3 — the Operations ledger invents no
       requirement and repeats none`, 4/6. Both directions caught it from one
       edit, which is the point of asserting both. Restored → 6/6.
    2. Duplicated the `**OPS-GATE-050**` row → `not ok 3`, 5/6, on the
       duplicate branch specifically. Restored → 6/6.
  - Honest limit: the fourth assertion — "no other ledger claims an OPS
    requirement" — is the one mutation could not exercise, because proving it
    means writing an `OPS-*` row into another family's ledger and eleven other
    agents were editing those files during this wave. It is asserted over
    `ledgerStatuses()`, which is the same union the global ratchet uses, and the
    parser it depends on is proven against synthetic input by test 6.

- [ ] **OPS-010-001** — Implement demand/supply/reservation/availability and approved plan handoff.
  - Status: FAIL
  - Reason: imported from `Tenure_Operations_Supply_Manufacturing_and_Service_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **OPS-010-002** — Implement inventory transactions, lot/serial/genealogy and valuation events.
  - Status: FAIL
  - Reason: imported from `Tenure_Operations_Supply_Manufacturing_and_Service_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **OPS-010-003** — Implement warehouse inbound/storage/work/outbound/count flows.
  - Status: FAIL
  - Reason: imported from `Tenure_Operations_Supply_Manufacturing_and_Service_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **OPS-010-004** — Implement order orchestration, fulfillment, returns and billing events.
  - Status: FAIL
  - Reason: imported from `Tenure_Operations_Supply_Manufacturing_and_Service_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **OPS-020-001** — Implement product structure/routing and declared manufacturing modes.
  - Status: FAIL
  - Reason: imported from `Tenure_Operations_Supply_Manufacturing_and_Service_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **OPS-020-002** — Implement work execution, WIP, yield/scrap/rework and accounting events.
  - Status: FAIL
  - Reason: imported from `Tenure_Operations_Supply_Manufacturing_and_Service_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **OPS-020-003** — Implement inspection/nonconformance/CAPA/traceability/recall.
  - Status: FAIL
  - Reason: imported from `Tenure_Operations_Supply_Manufacturing_and_Service_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **OPS-020-004** — Implement maintenance/assets/calibration/spares and Finance link.
  - Status: FAIL
  - Reason: imported from `Tenure_Operations_Supply_Manufacturing_and_Service_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **OPS-030-001** — Implement project/resource/time/cost/deliverable/change execution.
  - Status: FAIL
  - Reason: imported from `Tenure_Operations_Supply_Manufacturing_and_Service_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **OPS-030-002** — Implement service/field/dispatch/mobile/offline/acceptance.
  - Status: FAIL
  - Reason: imported from `Tenure_Operations_Supply_Manufacturing_and_Service_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **OPS-030-003** — Implement shipment/carrier/tracking/delivery/freight boundary.
  - Status: FAIL
  - Reason: imported from `Tenure_Operations_Supply_Manufacturing_and_Service_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **OPS-030-004** — Implement facility/space/workplace/site operations for declared scope.
  - Status: FAIL
  - Reason: imported from `Tenure_Operations_Supply_Manufacturing_and_Service_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **OPS-040-001** — Deliver command centers and frontline/mobile/scanner experiences with WCAG 2.2 AA.
  - Status: FAIL
  - Reason: imported from `Tenure_Operations_Supply_Manufacturing_and_Service_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **OPS-040-002** — Implement object/site/seat/shift operational memory and handoff.
  - Status: FAIL
  - Reason: imported from `Tenure_Operations_Supply_Manufacturing_and_Service_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **OPS-040-003** — Implement safe Relay tools and safety/approval boundaries.
  - Status: FAIL
  - Reason: the boundary holds and nothing is implemented behind it, which are
    two different sentences and only the first is true today.
  - What was derived rather than assumed, in
    `tools/ops-availability-and-limits.mjs` (`invocableRelayTools`) and published
    in §8 of `docs/architecture/ops-availability-and-limitations.md`: Relay's door
    is `apps/web/src/lib/relay-tools.ts`, `invokeRelayTool` refuses any tool
    absent from `TOOL_ARGUMENT_SCHEMAS`, and that allow-list holds exactly **1**
    key — `search.corpus`. So not one of §19's prohibited actions (quality
    release, recall closure, inventory write-off, shipment of controlled goods,
    maintenance safety clearance, customer promise, financial approval) is
    invocable by Relay at all.
  - Why that is not a PASS. §19 has an *allowed* half too — summarise exceptions,
    propose schedules/allocations, draft work instructions, explain genealogy,
    prepare shift handoff — and **zero** of those tools exist. A boundary that
    holds because there is nothing on either side of it has never been exercised:
    no Operations tool has been classified for risk, no Operations write has been
    put through `issueConfirmation`, and no Operations domain permission has been
    declared for `riskOf` above DRAFT to consult. Recording that as PASS would be
    the "holds by absence" reading this repository refuses elsewhere.
  - What it needs, and why it was not done here: a tool registration belongs to a
    module manifest (`relayToolsFor` reads `modulesFor(slug).enabled.flatMap(m =>
    m.tools)`), so an Operations Relay tool needs an Operations module, which
    needs the entities `OPS-000-002` records as BLOCKED_EXTERNAL. The edit would
    also land in `apps/web/src/lib/relay-tools.ts` and `modules/index.ts`, both of
    which the Work Graph and Pack Factory domains were editing during this wave —
    `TOOL_ARGUMENT_SCHEMAS` is a type-level widening whose construction sites
    spread across the workspace, and that needs one agent holding the file.
  - Tests: none new. `node --test tests/architecture/ops-availability-and-limits.test.mjs`
    → **13/13** asserts the derived fact above holds (`invocableRelayTools().length
    >= 1` and the §8 text), which is what stops this row's first paragraph going
    stale while it sits at FAIL.

- [ ] **OPS-040-004** — Certify enabled PLM/MES/QMS/LIMS/EDI/WMS/TMS/carrier/IoT connectors.
  - Status: FAIL
  - Reason: imported from `Tenure_Operations_Supply_Manufacturing_and_Service_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **OPS-040-005** — Pass offline, provider-outage, late-event and reconciliation tests.
  - Status: FAIL
  - Reason: imported from `Tenure_Operations_Supply_Manufacturing_and_Service_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [x] **OPS-050-001** — Implement industry/mode/jurisdiction exact availability and safety disclaimers.
  - Status: PASS
  - Code: `tools/ops-availability-and-limits.mjs` — the availability engine and
    the document it renders. Exports: `availabilityFor` (the two-condition
    decision), `availabilityUnderSelection` (one composition selection, with
    refusals), `releasedAreas`, `entityGroups`, `section`, `declaredModes`,
    `requiredExperiences`, `providerClasses`, `archetypeAxes`, `literalArray`,
    `operationsSuiteModules`, `invocableRelayTools`, `servedRoutes`,
    `areaProblems`, `build`, and the authored-but-checked `AREAS` and
    `DISCLAIMERS`. Output: `docs/architecture/ops-availability-and-limitations.md`,
    228 lines, nine sections.
  - Caller: three, all real. (1) `build()` renders the committed document;
    (2) `tests/architecture/ops-best-claim-is-measured.test.mjs:7` imports
    `releasedAreas` and enforces OPS-GATE-050 from it, so the availability
    decision gates what the repository is allowed to *say*; (3)
    `tests/architecture/ops-availability-and-limits.test.mjs` re-derives every row.
    All of it runs under `npm run test:platform` via
    `tools/run-platform-tests.mjs`'s filesystem discovery. No page and no server —
    which is the honest shape, because there is no Operations surface to render an
    availability badge onto, and inventing one would be the "product name,
    navigation item or API scaffold" the Pack Factory bible §6 refuses.
  - How availability is decided, so this is falsifiable rather than editorial. An
    area is `available` only if **both**: every canonical entity Bible §2 groups
    into it is declared in `apps/web/prisma/schema.prisma` under that name and is
    not one of the three collisions `OPS-000-001` recorded (`Deliverable`,
    `Delivery`, `Resource`); **and** the tenant app serves at least one route under
    the area's prefix, from `tools/entry-point-inventory.mjs`'s filesystem walk.
    Today: **13 of 13** areas `unavailable`, all on the model condition, 0 of 79
    entities declared, 40 tenant routes served, 0 under any Operations prefix.
  - The three axes the requirement names, each answered exactly:
    * **industry** — `ARCHETYPE_AXIS_IDS` in `blueprints/archetype.ts` is
      `organization`, `operatingModel`, `functional`. There is no `industry` axis;
      that file says why ("an IndustryPack … nothing produces one"). The nearest
      axis that exists is the organization archetype, and all **3** resolve to 0
      of 13 available, across all **5** operating models — 15 combinations, one
      answer, because availability is decided by the model and the surface and no
      axis value changes either.
    * **mode** — Bible §9's **5** declared modes, parsed from its own sentence.
      All 5 execute through the `production` area, which is unavailable, so the
      limitation is identical for all of them rather than invented per mode.
    * **jurisdiction** — a **refusal**, not an answer. There is no `geography`
      axis and no `JurisdictionPack`, so `availabilityUnderSelection({… ,
      jurisdiction: "DE"})` returns `{ ok: false, refusal:
      "no-jurisdiction-axis" }` and carries no `areas` field at all. Reporting
      "unavailable in Germany" would assert that somebody checked Germany. This is
      the codebase's central rule applied literally: "we looked and found nothing"
      and "we could not look" are different answers, and this is the axis where
      collapsing them would have been easiest.
  - Safety disclaimers: **4**, each *quoted* from the Bible section that states it
    (§1, §16, §19, §20), and `build()` throws if a quote is not a literal
    substring of that numbered section. A paraphrase cannot survive here, which is
    the point: a disclaimer that has drifted still reads as authoritative.
  - Tests: `node --test tests/architecture/ops-availability-and-limits.test.mjs`
    → **13/13**, 1.4s. Five of the thirteen exist only because this document's
    conclusion is "nothing is available", which is exactly what a generator that
    scanned nothing would also produce: floors on the entity groups (13+),
    entities (70+), routes (30+, and `/dashboard` by name), schema declarations
    (60+), modes (5+), experiences (10+), provider classes (10+) and invocable
    Relay tools (1+). Two more drive `availabilityFor` to `available` and
    `availabilityUnderSelection` to an answered jurisdiction against synthetic
    input, so neither is a constant.
  - Mutations: **4 applied, 4 caught, all restored**, 13/13 after each.
    1. Rewrote one committed table row to `| … | 4 | 7 | 7 | 1 | \`available\` | — |`
       by hand → `not ok 1 — the committed availability document is what the tree
       says today` and `not ok 8 — the areas the document publishes are the
       verdicts the tree yields`, 10/13. Restored.
    2. Changed the no-model branch of `availabilityFor` from `status:
       "unavailable"` to `status: "available"` → `not ok 1`, `not ok 6 —
       availability is decided, not returned`, `not ok 9 — no area is published
       available while its model is absent`, 9/13. Restored.
    3. Replaced the §16 disclaimer with the paraphrase
       `"Sensitive operational commands require approval."` → the generator
       *threw* (`The disclaimer quoted from §16 is not in that section`) and
       `not ok 1`, `2`, `10`, `11`, 8/13. Restored.
    4. Narrowed the jurisdiction refusal to
       `selection.jurisdiction === "a-jurisdiction-nobody-names"` — a literal no
       caller sends, chosen so no other token could absorb the change → `not ok 1`
       and `not ok 10 — a selection is resolved, and a question the platform
       cannot answer is refused`, 11/13. Restored.
    Each was applied alone and the suite was green again before the next: two
    mutations at once masked each other in this repository twice this week.
  - Honest limits:
    * The route prefixes in `AREAS` are authored (`/operations/inventory` and so
      on). They are validated for shape and uniqueness and they are deliberately
      NOT `/inventory` or `/orders`, because the app already serves `/resources`
      and `/approvals` and a colliding prefix would report an area `available` on
      the strength of a board-resource library. But nothing yet forces a future
      Operations page to be served under one, so the surface condition is a
      convention this document defines rather than one the router enforces.
    * "Available" is `model declared` + `surface served`. It is deliberately not
      "certified": there is no Operations scope-certification record anywhere, and
      inventing a third condition nothing can satisfy would have made the
      `available` branch unreachable, which is how a decision procedure quietly
      becomes a constant.
    * The generator is not in `npm run generate` — `package.json` is shared and
      was not editable in a twelve-agent wave, the same limit `OPS-000-001`
      records. Staleness is caught by test 1 rather than prevented.
    * The document commits counts derived from surfaces other domains own — the
      number of tenant routes the app serves, the number of models the schema
      declares. It is therefore a tripwire on those surfaces, deliberately, and
      the fix when it fires is one command, which the failure message gives.
      Two things were changed to keep that signal rather than noise: the
      connector row now cites `packages/provisioning/src/catalogs.ts` **without**
      the line number `catalogConnectors()` supplies, because a line number in
      another domain's file makes this guard red whenever somebody edits above it
      for reasons that have nothing to do with Operations.
    * Observed once during this wave, and worth recording because it is the exact
      scenario `guards-do-not-write-into-the-tree.test.mjs` was written for: test
      1 failed in a full parallel `npm run test:platform` run while passing on its
      own seconds later. In that same run,
      `tests/architecture/int-connector-write-boundary.test.mjs` was reported by
      that guard as writing a file into the tree and deleting it — so for a few
      hundred milliseconds the route walk this document derives from was looking
      at a repository that is not the committed one. The other agent removed the
      write; test 1 has been green in every run since. The lesson is not about
      that file, it is that a derived document is only as stable as the other
      guards' discipline about writing.

- [ ] **OPS-050-002** — Pass all twelve E2E scenarios with zero unexplained critical quantity/money variance.
  - Status: FAIL
  - Reason: imported from `Tenure_Operations_Supply_Manufacturing_and_Service_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **OPS-050-003** — Pass high-volume/concurrency/cell-failure/backup/restore/DR tests.
  - Status: FAIL
  - Reason: imported from `Tenure_Operations_Supply_Manufacturing_and_Service_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **OPS-050-004** — Instrument scorecard baseline/targets/results and competitor workflow benchmarks.
  - Status: FAIL
  - Reason: considered for this wave and rejected deliberately, because the
    cheapest version of it is the dishonest one. Bible §22 asks for **13** metric
    families — perfect-order/OTIF, inventory accuracy and adjustment rate,
    warehouse task time and throughput, schedule adherence/yield/scrap/OEE,
    quality escape and CAPA cycle, asset MTBF/MTTR, project schedule and cost
    variance, first-time fix, detection-to-resolution, operational-to-Finance
    unexplained variance, frontline task success, configuration-to-live time, and
    benchmarked public workflows against SAP/Oracle/Infor/IFS/Epicor and Intuit
    Enterprise Suite Construction. Every single one is computed over operational
    transactions, and `docs/architecture/ops-availability-and-limitations.md`
    derives that **0 of 79** canonical entities exist. A metric-definition
    registry could be written today; every `result` in it would be `unmeasured`,
    and a scorecard of thirteen blanks published under the word "instrumented" is
    an artefact that looks like measurement.
  - What it would need, precisely: `OPS-000-002` (the entities) plus at least one
    of `OPS-010-002` / `OPS-020-002` posting real transactions, and then a
    baseline captured before a change and a target agreed with somebody. The
    competitor half needs no schema and is a separate, honest piece of work —
    walking each vendor's public workflow documentation and recording step counts
    — but §22 binds it to "without copied trade dress" and to measured Tenure
    scope to compare against, so half of it alone is a benchmark of one side.
  - Not blocked on tooling: `docs/architecture/ux-task-scorecard.md` and
    `tests/architecture/ux-task-scorecard.test.mjs` are the shape this should take
    when there is something to measure, and `anl-single-metric-definition.test.mjs`
    already guards against a metric being defined twice. Neither is Operations
    machinery to be rebuilt.
  - Where this is written down for a reader who never opens this ledger: §9 of
    `docs/architecture/ops-availability-and-limitations.md` states that no §22
    metric is instrumented, and
    `tests/architecture/ops-best-claim-is-measured.test.mjs` passes `measured = []`
    into `permittedFor` for exactly that reason — so the FAIL here is load-bearing
    on the gate rather than inert.

- [ ] **OPS-050-005** — Publish exact industry/mode/site/device/provider limitations.
  - Status: FAIL
  - Overturned on review: The published content is real today -- I checked 3-7 against the tree (9 site-shaped entities none declared, Bible 17's 10 experiences vs 40 served tenant routes, Bible 20's 10 provider classes vs 1 ConnectorEntry `tenure.relay-anthropic` and 2 reviews both NOT_SUBMITTED, and the genuine finding that FUNCTIONAL_SUITES.operations composes ['approvals','events'] at blueprints/archetype.ts:112). REFUTED on mutation coverage, and by a mutation that SURVIVED. Nothing asserts that the limitation sections stay published: the only guards over the document are byte-equality with whatever the generator currently emits (test 1), the 2 availability rows/reasons (test 8) and the four disclaimer quotes (test 11). So I guarded the 5 emission behind `if (network === undefined)`, ran `node tools/ops-availability-and-limits.mjs`, and 'Limitations by site' vanished from the published document while ops-availability-and-limits stayed 13/13 and ops-best-claim-is-measured 7/7. Repeated one at a time for 7 behind `if (providers.length > 999)`: 'Limitations by provider' vanished, 13/13 and 7/7 again. Two of the five axes the requirement names can be silently unpublished by the ordinary workflow (edit generator, run the regeneration command the guard's failure message itself instructs) with no test going red. The claim's stated coverage is also inaccurate: mutation 1 'rewrote a published limitation row' -- it rewrote a row of 2, Capability availability by area, which test 8 guards; no mutation touched 3-7. The world-class-inventory mutation does reproduce (I planted it, ops-best-claim-is-measured went 6/7 naming the line), but that proves the overclaim policing of OPS-GATE-050, not that the limitations remain published. Fix: assert each axis heading and one derived line per axis exists in OUTPUT, the way test 11 already does for the disclaimers.
  - Code: the same generator as `OPS-050-001`,
    `tools/ops-availability-and-limits.mjs`, sections 3–7 of its output. Published
    at `docs/architecture/ops-availability-and-limitations.md`. One generator for
    both requirements because availability and limitation are one derivation read
    in two directions, and two generators over one schema is the second-parser
    defect this repository already carries a note about.
  - Caller: as `OPS-050-001` — `build()`, the two guards, and
    `npm run test:platform`.
  - The five axes, each derived from something the tree really declares:
    * **industry** (§3) — 3 organization archetypes, all 0-of-13 available; no
      `industry` axis exists at all, so the limitation is that Operations cannot be
      varied by industry, not that some industries are unsupported.
    * **mode** (§4) — Bible §9's 5 declared manufacturing modes, all unsupported
      through the `production` area.
    * **site** (§5) — the 9 site-shaped entities (`Site`,
      `InventoryOrganization`, `Warehouse`, `Subinventory`, `Locator`,
      `WorkCenter`, `Resource`, `Asset`, `Location`), none declared. With the two
      near-misses named so they are not counted as coverage: an AWS **cell** is not
      an operational site, and the schema's `Organization` is a student club, not
      an `InventoryOrganization`.
    * **device** (§6) — Bible §17's 10 required frontline experiences against the
      40 routes the app serves: **0** matched. The published consequence is exact —
      there is no Operations experience to assess on any device class, not a
      desktop one lacking a mobile variant — and WCAG 2.2 AA is therefore claimed
      for no Operations surface.
    * **provider** (§7) — Bible §20's 10 provider classes against two derived
      registries, reusing `catalogConnectors()` and `providerReviews()` from
      `tools/cat-integration-inventory.mjs` rather than parsing those files a
      second time: **1** `ConnectorEntry` exists (`tenure.relay-anthropic`,
      capability `completion`, review `NOT_SUBMITTED`) and **2** provider reviews,
      **2 of 2** not approved. Not one names an Operations provider class.
  - The finding this publication exists for, and the reason it is not filler.
    `FUNCTIONAL_SUITES` in `blueprints/archetype.ts` already contains a selectable
    value spelled **`operations`**, and `SUITE_MODULES` composes it as
    `["approvals", "events"]` — board approvals and a calendar. A tenant selecting
    "operations" today gets no inventory, no work order, no shipment and no
    maintenance, and nothing anywhere said so. `OPS-000-001`'s vocabulary scan
    could not see it: its 22-term list deliberately excludes the word
    `operations`, which in a Next.js application matches everything. §3 of the
    document now states it, and test 5 fails if the suite is renamed or its module
    list changes.
  - Tests: `node --test tests/architecture/ops-availability-and-limits.test.mjs`
    → **13/13**. Directly on this requirement: test 3's floors on modes (5+),
    experiences (10+), provider classes (10+) and archetypes/models/suites
    (3+/5+/8+); test 4 (no `industry`, no `geography` axis); test 5 (the
    `operations` suite collision); test 1 (byte equality with the committed
    document).
  - Mutations: covered by the four recorded under `OPS-050-001` — the same
    generator and the same guard file; mutation 1 in particular rewrote a
    published limitation row by hand and was caught by two assertions. One
    additional mutation aimed at this row specifically, applied and restored:
    planting `Tenure has world-class inventory accuracy.` into the published
    document was caught by `tests/architecture/ops-best-claim-is-measured.test.mjs`
    at `docs/architecture/ops-availability-and-limitations.md:230`, which is the
    proof that publishing a limitation and policing an overclaim are wired to each
    other rather than adjacent.
  - Honest limits:
    * "No connector for any provider class" is derived from the catalog and the
      review registry. A connector implemented outside the catalog — a raw `fetch`
      to a WMS in a route handler — would not appear in either, and this document
      would still say there is none. `tests/architecture/no-overstated-connectors.test.mjs`
      and the egress-host derivation in `cat-integration-inventory.mjs` are the
      guards for that shape; this document trusts them rather than repeating them.
    * The device axis measures *served routes*, which is a coarse proxy for a
      device class. It can prove there is no Operations experience at all; it could
      not, on its own, prove a future scanner flow has adequate touch targets.
      That is `OPS-040-001`'s work and it remains FAIL.

- [ ] **OPS-GATE-000** — Operational foundation preserves quantities, state and tenant isolation.
  - Status: FAIL
  - Reason: imported from `Tenure_Operations_Supply_Manufacturing_and_Service_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **OPS-GATE-010** — Supply-to-fulfillment works and reconciles.
  - Status: FAIL
  - Reason: imported from `Tenure_Operations_Supply_Manufacturing_and_Service_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **OPS-GATE-020** — Product and asset operations are traceable and controlled.
  - Status: FAIL
  - Reason: imported from `Tenure_Operations_Supply_Manufacturing_and_Service_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **OPS-GATE-030** — Service-, project-, network- and site-centric operations work.
  - Status: FAIL
  - Reason: imported from `Tenure_Operations_Supply_Manufacturing_and_Service_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **OPS-GATE-040** — Operations is usable, memory-first and integration-resilient.
  - Status: FAIL
  - Reason: imported from `Tenure_Operations_Supply_Manufacturing_and_Service_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **OPS-GATE-050** — “Best” is claimed only for measured released scope.
  - Status: FAIL
  - **This row was written as PASS and the repository refused it, correctly.**
    `tests/architecture/pass-requires-evidence.test.mjs` test 8 — "a gate is not
    PASS while a child it gates is undecided" — went red with
    `OPS-GATE-050: OPS-050-002=FAIL, OPS-050-003=FAIL, OPS-050-004=FAIL`. The
    rule is right and it is the whole reason gates are separate rows: a gate is a
    statement about a section, and a section with three undecided members has not
    been assessed however good the one mechanism in it is. So the status here is
    FAIL, and everything below is what shipped underneath it.
  - What is blocking, exactly: `OPS-050-002` (all twelve §23 E2E scenarios),
    `OPS-050-003` (high-volume, concurrency, cell-failure, backup/restore/DR) and
    `OPS-050-004` (the §22 scorecard). All three run over operational
    transactions, so all three are downstream of `OPS-000-002`, which is
    BLOCKED_EXTERNAL on `apps/web/prisma/schema.prisma` and on ADR-0004 leaving
    `Proposed`. No amount of work on the claim-policing half moves this gate.
  - What did ship, and it is real and running: the enforcement mechanism the gate
    will need on the day the other three are decided. It is not a stub and it is
    not waiting to be wired — it fails the build today if anybody writes an
    Operations superlative.
  - Code: `tests/architecture/ops-best-claim-is-measured.test.mjs` — the gate
    (`SUPERLATIVES`, `isOperationsSuperlative`, `readableText`, `claims`,
    `permittedFor`), over `releasedAreas` from
    `tools/ops-availability-and-limits.mjs`. Published side: §9 of
    `docs/architecture/ops-availability-and-limitations.md`, which states the
    permission the gate enforces.
  - Caller: `tools/run-platform-tests.mjs`'s filesystem discovery →
    `npm run test:platform` → `npm run verify` and CI. It imports `releasedAreas`
    at line 7, so this is not a second definition of "released": widen what the
    tree ships and the gate widens with it, and nothing else does.
  - What the gate actually decides, which is the part that makes it a gate rather
    than a grep. A claim is permitted only when its area is **released** *and*
    **measured**. Released = `available` on both conditions of the availability
    engine, currently **0 of 13** areas. Measured = the §22 metrics, currently
    **0**, per `OPS-050-004`. So `permittedFor` refuses every Operations
    superlative, and it refuses each with a distinguishable reason —
    `not-released` before `not-measured` — because "we have not shipped it" and
    "we shipped it and never measured it" are different admissions.
  - Surface scanned, measured rather than estimated — `claims()` returns its own
    counters and they were read: **695** `.ts`/`.tsx` files under `apps/web/src`
    and `apps/system-studio/src`, **69,934** readable text units extracted from
    them (string literals and JSX text, comments stripped), and **468** lines
    across the **2** `docs/architecture/ops-*.md` documents. **0** claims found.
    21 superlative forms, and a
    hit requires a superlative AND one of `OPS-000-001`'s 22 Operations terms in
    the same unit — "the best approach is to fail closed" is not an Operations
    claim and "the inventory transaction is idempotent" is not a superlative, and
    a guard that flagged either is a guard somebody deletes.
  - Tests: `node --test tests/architecture/ops-best-claim-is-measured.test.mjs`
    → **7/7**, 2.6s.
  - Mutations: **2 applied, 2 caught, both restored**, 7/7 after each — plus one
    end-to-end positive control that is permanent rather than temporary.
    1. Planted `Tenure has world-class inventory accuracy.` in
       `docs/architecture/ops-availability-and-limitations.md` → `not ok 3 —
       nothing claims an Operations superlative`, 6/7, reporting
       `docs/architecture/ops-availability-and-limitations.md:230 — "world-class"
       beside "inventory"` with the sentence. Restored.
    2. Changed `releasedAreas`'s filter from `status === "available"` to `status
       !== "never-used-literal"` — a literal chosen so no other token in the
       expression could absorb the edit — so every area reads as released →
       `not ok 2 — released Operations scope is empty, so no superlative is
       permitted`, 6/7, listing all 13. Restored. This is the mutation that
       matters: it proves the allow-list is derived from the tree, and that a
       future wave which ships an area cannot also keep the gate's silence for
       free.
    3. Permanent positive control, test 6: `claims()` takes its `base` as a
       parameter, and the test builds a directory in `os.tmpdir()` containing a
       `.tsx` with a string literal, a JSX node and a comment, plus an
       `ops-*.md`, then asserts the scan finds exactly the three planted claims
       and not the comment. Without it, `not ok 3` passing would be
       indistinguishable from a scan that reads nothing — which is the failure this
       repository has actually had. Writing to `os.tmpdir()` rather than the tree
       is required by `guards-do-not-write-into-the-tree.test.mjs`; that guard was
       run and passes on this file.
  - Honest limits, and the first is the real one:
    * The `not-measured` branch is **unreachable from the tree** while released
      scope is empty, so it is proven against synthetic input only (test 4). Half
      the rule is exercised by the repository and half by a fixture, and a reader
      should know which half is which.
    * The scan is lexical. It reads string literals and JSX text with regexes, not
      a TypeScript parse, so a superlative assembled at runtime from two variables
      would pass it. That is the same trade `certified-is-derived.test.mjs` makes
      and for the same reason.
    * Two files are deliberately not scanned, because both must be able to quote a
      claim in order to refuse it: the Bible, which states this rule, and this
      ledger. A superlative smuggled into this file would not be caught here.
    * Marketing copy outside these roots — the landing site, a README, a
      Terraform description — is not scanned. Nothing Operations-shaped exists in
      those today, and widening the roots would need the false-positive work doing
      again.
