# Operations, Supply, Manufacturing and Service — code inventory

**Generated. Do not edit by hand.**
Run `node tools/ops-operations-inventory.mjs`;
`tests/architecture/ops-operations-inventory.test.mjs` re-derives every row below
from the tree and fails when this file disagrees with it.

OPS-000-001 asks what operations, inventory, project, event and service code
this repository actually has, and what it falsely claims to have. The answer,
derived below rather than asserted, is that it has none and claims none.

That second half is the part worth having in writing. The expensive failure
mode for an Operations Cloud is not an empty schema, which nobody can
misread — it is a product that says `inventory` in a dozen places and a
reader who concludes some of it is stock on hand. Section 3 reads every one
of those places and records what the word means there.

## 1. Canonical entity coverage

Bible §2 "Shared operational model" names **79** distinct canonical
entities. `apps/web/prisma/schema.prisma` declares **76** models and enums.
**76** of the 79 have no declaration of that name at all;
the remaining **3** share a name with a Tenure record that is a different
thing, which section 2 sets out.

| Canonical entity | `apps/web/prisma/schema.prisma` |
| --- | --- |
| `AccountingEventReference` | absent |
| `Allocation` | absent |
| `Appointment` | absent |
| `Asset` | absent |
| `Availability` | absent |
| `BOM` | absent |
| `Batch` | absent |
| `CAPA` | absent |
| `Calibration` | absent |
| `Carrier` | absent |
| `Category` | absent |
| `Certificate` | absent |
| `ChangeOrder` | absent |
| `Container` | absent |
| `Customer` | absent |
| `Deliverable` | `model Deliverable` at line 317 — name only, see §2 |
| `Delivery` | `model Delivery` at line 740 — name only, see §2 |
| `Demand` | absent |
| `Dispatch` | absent |
| `Entitlement` | absent |
| `Facility` | absent |
| `Failure` | absent |
| `FieldVisit` | absent |
| `Formula` | absent |
| `FulfillmentLine` | absent |
| `HandlingUnit` | absent |
| `Inspection` | absent |
| `InventoryBalance` | absent |
| `InventoryOrganization` | absent |
| `InventoryTransaction` | absent |
| `Item` | absent |
| `LeaseReference` | absent |
| `Location` | absent |
| `Locator` | absent |
| `Lot` | absent |
| `MaintenancePlan` | absent |
| `MaintenanceWorkOrder` | absent |
| `Meter` | absent |
| `Milestone` | absent |
| `Nonconformance` | absent |
| `Operation` | absent |
| `OperationalEvent` | absent |
| `OperationalMemory` | absent |
| `Order` | absent |
| `OrderLine` | absent |
| `Partner` | absent |
| `Party` | absent |
| `Pegging` | absent |
| `Product` | absent |
| `ProductionRun` | absent |
| `Project` | absent |
| `Recall` | absent |
| `Recipe` | absent |
| `Reservation` | absent |
| `Resource` | `model Resource` at line 1460 — name only, see §2 |
| `ResourceDemand` | absent |
| `Return` | absent |
| `Revision` | absent |
| `Routing` | absent |
| `Serial` | absent |
| `Service` | absent |
| `ServiceCase` | absent |
| `ServiceOrder` | absent |
| `Shipment` | absent |
| `Site` | absent |
| `Space` | absent |
| `Specification` | absent |
| `Subinventory` | absent |
| `Supplier` | absent |
| `Supply` | absent |
| `Task` | absent |
| `UnitOfMeasure` | absent |
| `Variant` | absent |
| `Visitor` | absent |
| `WBS` | absent |
| `Warehouse` | absent |
| `WorkCenter` | absent |
| `WorkOrder` | absent |
| `WorkplaceRequest` | absent |

## 2. The name collisions

A missing model is obvious. A model with the right name and the wrong
meaning is not, and it is the reason a coverage count on its own would
overstate what is here. The `evidence` column is a literal substring of
the schema, so a description cannot drift from the declaration it describes.

| Name | What the Tenure record is | Evidence in the schema | What it is not |
| --- | --- | --- | --- |
| `Deliverable` | a compliance deadline an institution places on a board seat, with reminders | `/// Which board seat owns it, matching SeatKey in src/lib/resources.ts` | an OPS `Deliverable` is a contracted project output that is accepted and billed |
| `Delivery` | the record that one message reached one participant on one channel | `channel       String      // "in_app" \| "email" \| "push"` | an OPS `Delivery` is goods arriving at a ship-to location |
| `Resource` | a board resource — a form, guide, policy, tool or checklist, routed to seats | `/// A board resource — a form, guide, policy, tool or checklist, routed to the` | an OPS `Resource` is a work-centre resource: labour, machine or tool capacity |

## 3. Operations vocabulary in the tenant product

Scanned: `apps/web/src`, `modules`, `packages` — every `.ts`/`.tsx` file, for
22 Operations terms. **27** matches in
**14** files.

Out of scope: the operator plane (`apps/system-studio/src`). Its Operations
vocabulary is the AWS estate sense — `apps/system-studio/src/lib/aws/inventory.ts`
is the module that lists AWS resources — and the Studio reads AWS, never the
tenant database, so nothing there is a claim about tenant operations. Its match
count is deliberately not recorded: it is in the hundreds, it moves with work
that has nothing to do with this domain, and a number in a committed file that
somebody else's commit invalidates is a stale artefact waiting to happen. The
guard holds it to a floor instead, so the exclusion cannot become an empty scan.

| File | Line | Term |
| --- | --- | --- |
| `apps/web/src/lib/a11y/theme-tokens.ts` | 23 | inventory |
| `apps/web/src/lib/a11y/theme-tokens.ts` | 33 | inventory |
| `apps/web/src/lib/a11y/theme-tokens.ts` | 157 | inventory |
| `apps/web/src/lib/dev-login.ts` | 12 | procurement |
| `apps/web/src/lib/partition-services.ts` | 24 | inventory |
| `apps/web/src/lib/policies.ts` | 293 | logistics |
| `packages/identity/src/handoff.test.ts` | 235 | inventory |
| `packages/identity/src/handoff.ts` | 132 | inventory |
| `packages/identity/src/handoff.ts` | 133 | inventory |
| `packages/identity/src/handoff.ts` | 142 | inventory |
| `packages/identity/src/session.test.ts` | 273 | inventory |
| `packages/identity/src/session.test.ts` | 289 | inventory |
| `packages/identity/src/session.ts` | 12 | inventory |
| `packages/identity/src/session.ts` | 152 | inventory |
| `packages/identity/src/session.ts` | 271 | inventory |
| `packages/identity/src/session.ts` | 273 | inventory |
| `packages/organization-model/src/organization-model.test.ts` | 175 | logistics |
| `packages/organization-model/src/organization-model.test.ts` | 176 | logistics |
| `packages/organization-model/src/organization-model.test.ts` | 181 | logistics |
| `packages/organization-model/src/position-lifecycle.test.ts` | 144 | warehouse |
| `packages/organization-model/src/topology.ts` | 29 | warehouse |
| `packages/organization-model/src/topology.ts` | 222 | warehouse |
| `packages/platform-config/src/module-permissions.test.ts` | 157 | procurement |
| `packages/platform-config/src/module-permissions.test.ts` | 171 | procurement |
| `packages/provisioning/src/provisioning.test.ts` | 474 | procurement |
| `packages/provisioning/src/resource-tags.ts` | 33 | inventory |
| `packages/provisioning/src/resource-tags.ts` | 38 | inventory |

### Verdicts

| File | Verdict | The word means |
| --- | --- | --- |
| `apps/web/src/lib/a11y/theme-tokens.ts` | unrelated-word | the design token inventory in `tools/entry-point-inventory.mjs` — a list of CSS custom properties |
| `apps/web/src/lib/dev-login.ts` | unrelated-word | an institution's purchasing timetable for Okta, in a comment about when the dev door can be removed |
| `apps/web/src/lib/partition-services.ts` | unrelated-word | "an inventory of *this app's* dependencies" — which AWS services the application calls |
| `apps/web/src/lib/policies.ts` | unrelated-word | OSE policy text shown to a club: "All logistics, planning and expenses are managed by students" |
| `packages/identity/src/handoff.test.ts` | unrelated-word | the same `source: "inventory"` string, in a fixture |
| `packages/identity/src/handoff.ts` | unrelated-word | `docs/architecture/aws-inventory.json`, the source a handoff field cites |
| `packages/identity/src/session.test.ts` | unrelated-word | `sessionInventory`, the same list of sessions |
| `packages/identity/src/session.ts` | unrelated-word | the "device/session inventory" of Bible §21.2 — a person's live sessions |
| `packages/organization-model/src/organization-model.test.ts` | unrelated-word | a department named `logistics` in an org-topology fixture |
| `packages/organization-model/src/position-lifecycle.test.ts` | unrelated-word | `unit-warehouse`, a fixture unit type that holds no seats |
| `packages/organization-model/src/topology.ts` | unrelated-word | "a warehouse has people *at* it and no seats *in* it" — the GE-050-003 argument for `holdsSeats` |
| `packages/platform-config/src/module-permissions.test.ts` | unrelated-word | `key: "procurement"`, a deliberately foreign manifest key the catalog must refuse |
| `packages/provisioning/src/provisioning.test.ts` | unrelated-word | `systemOfRecord: { procurement: "external" }`, a deliberately unknown domain the validator must refuse |
| `packages/provisioning/src/resource-tags.ts` | unrelated-word | `apps/system-studio/src/lib/aws/inventory.ts` calling `tagProblems` on AWS resources |

**0** of the 14 are Operations capability claims.
No shipped file claims an Operations capability, so there is no false claim to withdraw — the finding is an absence, not an overstatement.

## 4. What follows from this

- OPS-000-002 (shared product/site/item/UOM/order/supply/inventory/work/asset/
  project/service models) starts from zero: 76 of 79 canonical entities
  have no declaration, and the three that share a name are not the entity.
  Every one of them is a table, so the work lands in
  `apps/web/prisma/schema.prisma` and a migration beside it.
- OPS-000-003 (state machines, idempotency, concurrency, operational event
  contracts) has nothing to sequence until those entities exist. The
  platform does already carry the two mechanisms it would use —
  `model OutboxEvent` and `model InboxEvent` in the same schema — so the
  event half is a contract over existing machinery rather than new machinery.
- No Operations claim is withdrawn by this inventory, because none was made.
