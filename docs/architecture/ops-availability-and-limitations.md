# Operations — availability, safety disclaimers and published limitations

**Generated. Do not edit by hand.**
Run `node tools/ops-availability-and-limits.mjs`;
`tests/architecture/ops-availability-and-limits.test.mjs` re-derives every row
below from the tree and fails when this file disagrees with it.

OPS-050-001 asks for exact availability by industry, mode and jurisdiction, with
safety disclaimers. OPS-050-005 asks for published limitations by industry, mode,
site, device and provider. Both are answered here, and neither answer is typed in:
availability is decided by `availabilityFor()` from two conditions read off the
tree — is the canonical model declared, and is a surface served — and every
disclaimer is quoted from the Bible section that states it, with the generator
refusing to emit if a quote is not a literal substring of that section.

The summary answer is that **no Operations capability is available in any
industry, under any operating model, in any jurisdiction, on any device class,
against any provider.** That is worth publishing precisely because it is
unsurprising to a reader who knows the schema and invisible to one who does not.

## 1. How availability is decided

An area is `available` only when **both** hold, and `unavailable` naming the
first that does not:

1. **Model** — every canonical entity Bible §2 groups into the area is declared
   under that name in `apps/web/prisma/schema.prisma`, and is not one of the
   3 name collisions `docs/architecture/ops-operations-code-inventory.md`
   records (`Deliverable`, `Delivery`, `Resource` exist in that schema
   meaning something else entirely).
2. **Surface** — the tenant app serves at least one route under the area's
   prefix. Served routes are walked from the filesystem by
   `tools/entry-point-inventory.mjs`, so deleting a page changes this answer
   with no edit here.

The app serves **40** tenant routes today. Bible §2 names
**79** canonical entities; `apps/web/prisma/schema.prisma` declares
**76** models and enums.

## 2. Capability availability, by area

| Area | §2 bullet | Entities | Modelled | Routes served | Availability | Failing condition |
| --- | --- | --- | --- | --- | --- | --- |
| Product, item and service master | 0 | 7 | 0 | 0 | `unavailable` | model |
| Sites, warehouses, work centres and assets | 1 | 9 | 0 | 0 | `unavailable` | model |
| Supplier, customer, carrier and partner references | 2 | 5 | 0 | 0 | `unavailable` | model |
| Demand, supply, reservation and availability | 3 | 6 | 0 | 0 | `unavailable` | model |
| Lots, serials, balances and inventory transactions | 4 | 7 | 0 | 0 | `unavailable` | model |
| Orders, fulfillment, shipment and returns | 5 | 6 | 0 | 0 | `unavailable` | model |
| Product structure, routing and work execution | 6 | 7 | 0 | 0 | `unavailable` | model |
| Inspection, nonconformance, CAPA and recall | 7 | 6 | 0 | 0 | `unavailable` | model |
| Maintenance, meters, failures and calibration | 8 | 5 | 0 | 0 | `unavailable` | model |
| Projects, WBS, milestones and change orders | 9 | 7 | 0 | 0 | `unavailable` | model |
| Service cases, dispatch, field visits and entitlements | 10 | 6 | 0 | 0 | `unavailable` | model |
| Facilities, spaces, visitors and workplace requests | 11 | 5 | 0 | 0 | `unavailable` | model |
| Operational events, accounting references and memory | 12 | 3 | 0 | 0 | `unavailable` | model |

**13 of 13** areas are unavailable. The reason for each,
in the decision's own words:

- `master-data` — no canonical entity of this area is declared in apps/web/prisma/schema.prisma.
- `network` — no canonical entity of this area is declared in apps/web/prisma/schema.prisma.
- `parties` — no canonical entity of this area is declared in apps/web/prisma/schema.prisma.
- `demand-supply` — no canonical entity of this area is declared in apps/web/prisma/schema.prisma.
- `inventory` — no canonical entity of this area is declared in apps/web/prisma/schema.prisma.
- `orders` — no canonical entity of this area is declared in apps/web/prisma/schema.prisma.
- `production` — no canonical entity of this area is declared in apps/web/prisma/schema.prisma.
- `quality` — no canonical entity of this area is declared in apps/web/prisma/schema.prisma.
- `maintenance` — no canonical entity of this area is declared in apps/web/prisma/schema.prisma.
- `projects` — no canonical entity of this area is declared in apps/web/prisma/schema.prisma.
- `service` — no canonical entity of this area is declared in apps/web/prisma/schema.prisma.
- `facilities` — no canonical entity of this area is declared in apps/web/prisma/schema.prisma.
- `operational-events` — no canonical entity of this area is declared in apps/web/prisma/schema.prisma.

## 3. Availability by industry, operating model and jurisdiction

The composition axes this engine really has are `organization`, `operatingModel`, `functional`
(`blueprints/archetype.ts`). **`industry` is not one of them, and neither is
`geography`** — that file states why: an industry axis needs an `IndustryPack`,
and nothing produces one; a geography axis needs a `JurisdictionPack`, and
localization is already set per blueprint and tenant.

So the exact answer to "which industries and jurisdictions is Operations
available in" is not a list of some — it is that **the platform cannot vary
Operations by industry or by jurisdiction at all**, and every Operations area
is unavailable in all of them. The nearest industry-shaped axis that does exist
is the organization archetype, of which there are 3:

- `university-student-organizations` — every Operations area unavailable.
- `nonprofit-program-operations` — every Operations area unavailable.
- `corporate-divisions` — every Operations area unavailable.

Crossed with the 5 operating models
(`centralized`, `decentralized`, `federated`, `matrix`, `shared-services`) that is
15 combinations, and the
verdict is the same in every one: availability is decided by the model and the
surface, neither of which any axis value changes.

### The answer is resolved, and a jurisdiction question is refused

`availabilityUnderSelection()` resolves this per selection rather than leaving
it as prose, and it distinguishes the two answers that must never be collapsed.
Three examples, each the function's real output:

- `university-student-organizations` / `centralized` — a selection the engine can build: answered, **0 of 13** areas available.
- `manufacturing` / `centralized` — an archetype it cannot: refused, `unknown-archetype`. `manufacturing` is not one of the 3 organization archetypes this engine builds.
- `university-student-organizations` / `centralized` / `DE` — a jurisdiction question: refused, `no-jurisdiction-axis`. Availability cannot be resolved for jurisdiction `DE`: blueprints/archetype.ts declares no `geography` axis and nothing produces a JurisdictionPack, so there is nothing to resolve against. This is a refusal, not an answer — reporting "unavailable" here would imply somebody checked.

The third is the one worth reading twice. "Unavailable in Germany" would be a
claim that somebody checked Germany; nobody can, so the answer is a refusal that
names why. That distinction is this codebase's central rule and it is the
difference between a limitation and a guess.

### The `operations` functional suite is not this

`FUNCTIONAL_SUITES` in `blueprints/archetype.ts` contains a value spelled
`operations`, and it is selectable today. It composes
`approvals` and `events` — board approvals and a
calendar. It is **not** the Operations Cloud, it grants no inventory, work
order, shipment or maintenance capability, and a tenant selecting it receives
exactly those two modules. This is published here because it is the one
Operations claim in the product a reader could reasonably misread, and the
vocabulary scan in `docs/architecture/ops-operations-code-inventory.md` cannot
see it: that scan deliberately excludes the word `operations`, which in a
Next.js application matches everything.

## 4. Limitations by manufacturing mode

Bible §9 declares 5 modes. Every one of them executes through the
product-structure and work area, which is `unavailable`:
no canonical entity of this area is declared in apps/web/prisma/schema.prisma. So no mode is supported, and the limitation is
identical for all of them rather than mode-specific:

- **discrete** — unsupported; no canonical entity of this area is declared in apps/web/prisma/schema.prisma.
- **repetitive** — unsupported; no canonical entity of this area is declared in apps/web/prisma/schema.prisma.
- **process/batch** — unsupported; no canonical entity of this area is declared in apps/web/prisma/schema.prisma.
- **configure/make/engineer-to-order** — unsupported; no canonical entity of this area is declared in apps/web/prisma/schema.prisma.
- **project manufacturing** — unsupported; no canonical entity of this area is declared in apps/web/prisma/schema.prisma.

## 5. Limitations by site

Site-shaped operations live in the `network` area —
`Site`, `InventoryOrganization`, `Warehouse`, `Subinventory`, `Locator`, `WorkCenter`, `Resource`, `Asset`, `Location` — which is
`unavailable`: no canonical entity of this area is declared in apps/web/prisma/schema.prisma.

Two words that are not this, so a reader does not count them as coverage:

- **Cells.** `placementFor` and the cell registry place a *tenant* in an AWS
  cell. A cell is not an operational site, has no inventory organization and
  no locators, and multi-cell placement is not multi-site operations.
- **Institutions and organizations.** The tenant schema's `Organization` is a
  student club or a division, not an `InventoryOrganization`.

## 6. Limitations by device class

Bible §17 requires 10 frontline experiences, several of them
explicitly for scanners, gloves and mobile use. None is served: the app's
40 tenant routes include no route under any Operations prefix, so
there is no Operations experience to assess on any device class — not a
desktop one that is missing a mobile variant, none at all.

| Required experience (§17) | Routes served under any Operations prefix |
| --- | --- |
| Operations command center: exceptions, queues, commitments, bottlenecks and site health. | 0 |
| Product/item/master workbench. | 0 |
| Order/fulfillment workspace. | 0 |
| Inventory and warehouse mobile/scanner flows. | 0 |
| Production dispatch and supervisor board. | 0 |
| Quality inspection/nonconformance/CAPA. | 0 |
| Maintenance planner/technician mobile. | 0 |
| Project/service/field workspaces. | 0 |
| Logistics tracking and exception management. | 0 |
| Site/facilities operations. | 0 |

The accessibility consequence is stated rather than implied: WCAG 2.2 AA
conformance is claimed for no Operations surface, because there is no
Operations surface to conform. `OPS-040-001` remains FAIL for that reason.

## 7. Limitations by provider

Bible §20 routes 10 provider classes through the Integration
Plane. Two things would have to exist for any of them to be claimable, and both
are read from the tree rather than described:

- **Connectors.** `catalogConnectors()` finds **1** `ConnectorEntry`
  declared in the provisioning catalog:

  - `tenure.relay-anthropic` — provider `anthropic`, capability `completion`, lifecycle `PUBLISHED`, capability status `CERTIFICATION_PENDING`, review `NOT_SUBMITTED` (declared in packages/provisioning/src/catalogs.ts).

- **Provider reviews.** **2** recorded, of which
  **2** are not approved:
  `GRAPH_CALENDAR_REVIEW` = `NOT_SUBMITTED`, `RELAY_ANTHROPIC_REVIEW` = `NOT_SUBMITTED`.

Not one connector and not one review names an Operations provider class. So the
limitation for every class below is the same, and it is absolute — no connector,
no review, no claim:

- **PLM/CAD** — no connector, no provider review, unavailable.
- **MES** — no connector, no provider review, unavailable.
- **QMS/LIMS** — no connector, no provider review, unavailable.
- **WMS/TMS/carriers** — no connector, no provider review, unavailable.
- **EDI/supplier networks** — no connector, no provider review, unavailable.
- **ecommerce/POS** — no connector, no provider review, unavailable.
- **IoT/historian** — no connector, no provider review, unavailable.
- **equipment** — no connector, no provider review, unavailable.
- **scanning/RFID** — no connector, no provider review, unavailable.
- **external ERP** — no connector, no provider review, unavailable.

## 8. Safety disclaimers

Quoted from the Bible sections that state them. The generator refuses to emit
if a quote is not a literal substring of the section it names, so these cannot
drift from the authority while continuing to read as authoritative.

- **§1** — Specialized safety, clinical, process-control, CAD geometry and machine-control systems remain external until separately certified.
- **§16** — Sensitive/dangerous operational commands require step-up/SoD/approval.
- **§19** — Protected or prohibited: no autonomous unsafe machine action, quality release, recall closure, inventory write-off, shipment of controlled goods, maintenance safety clearance, customer promise or financial approval.
- **§20** — Do not promise hard real-time safety/control latency on ordinary cloud workflows.

Two of the four bind code that exists rather than code that does not, and that
is the part worth being exact about:

- §19's prohibition is enforceable today because Relay's door is real:
  `apps/web/src/lib/relay-tools.ts` refuses any tool absent from its `TOOL_ARGUMENT_SCHEMAS`
  allow-list, and that list holds **1** key(s):
  `search.corpus`. None is an Operations tool, so
  none of §19's prohibited actions — quality release, recall closure, inventory
  write-off, shipment of controlled goods, maintenance safety clearance — is
  invocable by Relay at all. The boundary holds by absence, which is honest and
  is not the same as holding by design: `OPS-040-003` stays FAIL because no
  Operations tool is declared and therefore no Operations approval boundary has
  been exercised.
- §20's "do not promise hard real-time safety/control latency" is a promise
  this document is the place to not make. Nothing in this repository offers a
  latency SLO for an operational control loop.

The other two — §1's externality of specialized safety, clinical,
process-control, CAD and machine-control systems, and §16's step-up/SoD
requirement on dangerous commands — describe boundaries around capability that
does not exist yet. They are published so that the wave which builds it inherits
them, not because anything here enforces them.

## 9. Released scope, and what may therefore be called best

OPS-GATE-050 permits a superlative claim only for **measured released scope**.
Released scope is the set of areas that are `available` on both conditions of §1,
and it currently holds **0** areas
— it is empty.

So the exact permission is: **no Operations superlative may be claimed anywhere**,
for any area, on any axis, against any competitor. Bible §26 forbids claiming
"best without operational metrics" and Bible §22 lists the metrics that would
have to exist first; none of them is instrumented, which `OPS-050-004` records as
FAIL rather than as a scorecard of blanks.

`tests/architecture/ops-best-claim-is-measured.test.mjs` enforces this against the
product's own strings and against these documents, using this same derivation —
so a wave that genuinely ships and measures an area widens what may be said, and
nothing else does.
