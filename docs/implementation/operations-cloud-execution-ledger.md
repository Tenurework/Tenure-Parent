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
       terms: **27** matches in **14** files, and every one is a different
       sense of the word — the design-token inventory, an institution's
       procurement timetable for Okta, a `logistics` department in an
       org-topology fixture, the device/session inventory of Bible §21.2, a
       `key: "procurement"` manifest the catalog exists to refuse. **0 of 14**
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
  - Reason: imported from `Tenure_Operations_Supply_Manufacturing_and_Service_Cloud_Claude_Bible_v1.0.md`; not yet implemented

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
  - Reason: imported from `Tenure_Operations_Supply_Manufacturing_and_Service_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **OPS-040-004** — Certify enabled PLM/MES/QMS/LIMS/EDI/WMS/TMS/carrier/IoT connectors.
  - Status: FAIL
  - Reason: imported from `Tenure_Operations_Supply_Manufacturing_and_Service_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **OPS-040-005** — Pass offline, provider-outage, late-event and reconciliation tests.
  - Status: FAIL
  - Reason: imported from `Tenure_Operations_Supply_Manufacturing_and_Service_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **OPS-050-001** — Implement industry/mode/jurisdiction exact availability and safety disclaimers.
  - Status: FAIL
  - Reason: imported from `Tenure_Operations_Supply_Manufacturing_and_Service_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **OPS-050-002** — Pass all twelve E2E scenarios with zero unexplained critical quantity/money variance.
  - Status: FAIL
  - Reason: imported from `Tenure_Operations_Supply_Manufacturing_and_Service_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **OPS-050-003** — Pass high-volume/concurrency/cell-failure/backup/restore/DR tests.
  - Status: FAIL
  - Reason: imported from `Tenure_Operations_Supply_Manufacturing_and_Service_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **OPS-050-004** — Instrument scorecard baseline/targets/results and competitor workflow benchmarks.
  - Status: FAIL
  - Reason: imported from `Tenure_Operations_Supply_Manufacturing_and_Service_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **OPS-050-005** — Publish exact industry/mode/site/device/provider limitations.
  - Status: FAIL
  - Reason: imported from `Tenure_Operations_Supply_Manufacturing_and_Service_Cloud_Claude_Bible_v1.0.md`; not yet implemented

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
  - Reason: imported from `Tenure_Operations_Supply_Manufacturing_and_Service_Cloud_Claude_Bible_v1.0.md`; not yet implemented
