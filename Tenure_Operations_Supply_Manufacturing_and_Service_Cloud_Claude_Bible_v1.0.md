# Tenure Operations, Supply, Manufacturing, Asset, Project, and Service Cloud Bible

**Version:** 1.0  
**Date:** 2026-08-04  
**Status:** Binding first-party core-system architecture and Claude Code execution specification  
**Ambition:** Best memory-first operational system for product-, service-, project-, asset-, site-, and network-centric enterprises  

---

## BEGIN CLAUDE CODE MASTER PROMPT

You are the principal operations/SCM architect, manufacturing systems architect, inventory/WMS/TMS engineer, project/service/EAM architect, quality engineer, distributed-systems lead, mobile/offline UX architect, integration/security lead, test lead, and hands-on implementation owner for **Tenure Operations Cloud**.

Build Operations as a first-party Tenure core system. It must connect demand, supply, orders, inventory, production, quality, assets, projects, field/service work, facilities and logistics to Finance, Planning, People and institutional memory. It is not a generic task list or shallow inventory CRUD.

“Best” means reliable execution under real volume and failure; accurate quantities/cost/status; rapid exception resolution; strong traceability; flexible industry composition; usable frontline workflows; connected plans and financials; lower implementation burden; and role/site/asset/process memory that survives turnover.

## 1. Constitutional boundaries

Read the complete Tenure document graph. This Bible owns Operations canonical semantics. Planning owns scenarios/approved targets; Finance owns posting; People owns workers/assignments; Integration owns external PLM/MES/QMS/LIMS/WMS/TMS/carrier/EDI/IoT connections. Specialized safety, clinical, process-control, CAD geometry and machine-control systems remain external until separately certified.

All Tenure runtime stays in Tenure-owned AWS. No customer forks.

## 2. Shared operational model

Canonical entities include:

- `Product`, `Item`, `Service`, `Variant`, `UnitOfMeasure`, `Category`, `Revision`.
- `Site`, `InventoryOrganization`, `Warehouse`, `Subinventory`, `Locator`, `WorkCenter`, `Resource`, `Asset`, `Location`.
- `Party`, `Supplier`, `Customer`, `Carrier`, `Partner` references.
- `Demand`, `Supply`, `Reservation`, `Allocation`, `Pegging`, `Availability`.
- `Lot`, `Serial`, `Batch`, `Container`, `HandlingUnit`, `InventoryBalance`, `InventoryTransaction`.
- `Order`, `OrderLine`, `FulfillmentLine`, `Shipment`, `Delivery`, `Return`.
- `BOM`, `Formula`, `Recipe`, `Routing`, `Operation`, `WorkOrder`, `ProductionRun`.
- `Inspection`, `Specification`, `Nonconformance`, `CAPA`, `Certificate`, `Recall`.
- `MaintenancePlan`, `MaintenanceWorkOrder`, `Meter`, `Failure`, `Calibration`.
- `Project`, `WBS`, `Task`, `Milestone`, `ResourceDemand`, `Deliverable`, `ChangeOrder`.
- `ServiceCase`, `ServiceOrder`, `Appointment`, `Dispatch`, `FieldVisit`, `Entitlement`.
- `Facility`, `Space`, `LeaseReference`, `Reservation`, `Visitor`, `WorkplaceRequest`.
- `OperationalEvent`, `AccountingEventReference`, `OperationalMemory`.

Every quantity has item, unit, location/site, ownership, lot/serial/status, effective/transaction time and source. Every state change is idempotent and auditable.

## 3. Master data and product lifecycle

- Product/item/service master with lifecycle, revisions, effectivity, variants, attributes, units/conversions, dimensions/weight, packaging, shelf life, hazards/classification references and approved suppliers/customers.
- BOM/formula/recipe and routing/operation versions with alternates, substitutes, yields, scrap, effectivity and engineering change.
- Document/specification links and release approval.
- PLM/CAD integration preserves external authority and revision/checksum lineage.
- Master-data governance with request, duplicate match, steward approval, effective change and downstream impact.

## 4. Demand, supply and availability

- Independent/dependent demand, forecast/order/project/maintenance demand.
- Purchase/transfer/production/on-hand/in-transit supply.
- Reservations, allocations, promising and pegging.
- Safety stock, reorder, min/max, lead time, sourcing and policy parameters.
- Planning Cloud produces scenarios/recommendations; Operations converts approved recommendations to executable requisitions/orders/work only through protected commands.
- Shortage/excess/late supply exceptions have owner, cause, alternatives, financial/customer impact and resolution memory.

## 5. Inventory management

- Receipt, inspection, putaway, transfer, issue, return, adjustment, count, reservation, pick, pack, ship and ownership change.
- Lot/serial/batch genealogy, expiration, quarantine, quality status and recall.
- Multiple units, catch weight/dual UOM where certified, consigned and customer/supplier-owned inventory.
- Valuation/accounting integration with Finance by configured method and exact scope.
- No negative inventory unless explicitly permitted by item/site policy; corrections preserve history.
- Availability is computed under consistent snapshot/concurrency semantics.

## 6. Warehouse management

- Inbound appointments, ASN, receiving, directed putaway, cross-dock.
- Slotting, replenishment, wave/work release, task assignment/interleaving.
- Picking strategies, packing, cartonization, labels, staging, loading and shipping.
- Cycle count, physical inventory and variance approval.
- Labor/equipment/automation integration and mobile scanning.
- Offline operations use signed bounded work packages, conflict rules and reconciliation; never unrestricted local databases.

## 7. Order management and fulfillment

- Quote/order/import, validation, pricing reference, credit/hold, scheduling, reservation, orchestration, fulfillment, shipment, billing trigger, cancellation and return.
- Split/merge/backorder/substitute/drop ship/direct delivery and service/digital fulfillment modes.
- Distributed order management and system-of-record rules.
- Customer promise changes are explicit, approved where required and communicated through governed templates.
- Finance receives validated billing/accounting events; Operations does not create receivable journals directly.

## 8. Procurement and supplier operations

- Supplier qualification/risk, sourcing/RFx, catalogs, requisition, approval, PO, schedule, acknowledgement, receipt, service confirmation, change and close.
- Direct material, indirect, service, subcontract and consignment patterns.
- EDI/supplier network exchange with acknowledgement and reconciliation.
- Procurement/Finance SoD and spend/budget controls.
- Supplier performance and issue memory attach to categories, sites, parts and accountable seats.

## 9. Manufacturing execution

Support declared modes: discrete, repetitive, process/batch, configure/make/engineer-to-order and project manufacturing.

- Work/process order creation, release, material reservation/issue/return, operation dispatch, resource/labor/machine reporting, completion, co-/by-product, yield, scrap, rework and close.
- Capacity/calendar/tool/skill constraints and alternate resources.
- Lot/serial genealogy from incoming material through finished product.
- WIP and production-cost accounting events with variance reconciliation.
- MES/IoT integration for shop-floor observation; safety interlocks/machine control stay in certified operational systems.
- Electronic records/signatures only for exact validated scope.

## 10. Quality management

- Specification/plan, sampling, inspection/test, result, disposition, nonconformance, deviation, quarantine, rework, CAPA, audit and certificate.
- Supplier, incoming, in-process, final, customer and field quality.
- LIMS/QMS integration and result/version lineage.
- Recall scope, impacted lots/serials/customers/shipments and response workflow.
- Regulated validation/GxP/medical/aerospace scope remains unavailable until separately certified.

## 11. Maintenance and enterprise assets

- Asset hierarchy, location, meter, warranty, criticality, bill of material, condition and history.
- Preventive/predictive/corrective plans, service requests, work orders, permits/safety references, labor/material/tools, downtime, failure/cause/remedy and close.
- Spare-part reservation and procurement/warehouse integration.
- Calibration and certification expiry.
- Capitalization/asset book/expense accounting through Finance.
- Predictive recommendations require evidence and human/safety governance.

## 12. Projects and professional operations

- Program/portfolio/project/WBS/task/milestone, dependencies, baseline, resource demand/assignment, time/expense, cost/commitment, billing/revenue trigger, risk/issue, deliverable/acceptance and change order.
- Project-centric construction/engineering/services packs extend retainage, progress billing, subcontract, field evidence and job cost.
- Planning owns scenario/portfolio optimization; Operations owns approved execution.
- Full project-to-profit drill-through with Finance and People.

## 13. Service, field and customer operations

- Entitlement/warranty/SLA, case, diagnosis, work/service order, appointment, dispatch, route, technician, parts, labor, evidence, customer signature/acceptance and billing trigger.
- Skill/location/availability scheduling from People and inventory.
- Mobile/offline execution with minimized data, expiry, device security and sync conflicts.
- Remote support/IoT observations under consent and security.
- Service knowledge and fix history attach to product/asset/site and durable service seats.

## 14. Logistics and transportation

- Shipment, load, route, stop, package/container, carrier/service, rate, tender, booking, document, tracking, delivery/proof and freight settlement reference.
- Inbound/outbound/intercompany/transfer/returns.
- TMS/carrier/customs/global-trade integrations by exact supported scope.
- Distinguish label created, tender accepted, picked up, in transit, delivered and reconciled.

## 15. Facilities, workplace and site operations

- Facility/site/space, reservation, work request, maintenance, access/visitor reference, lease/utility/sustainability data and emergency plan.
- Employee/member workplace experience integrates People identity and authorization.
- Facility safety/physical access systems remain governed integrations unless specifically implemented.

## 16. Operational controls and invariants

- No overship/overreceive/overconsume outside explicit tolerance and approval.
- No negative/duplicate inventory effect from retry.
- Lot/serial uniqueness and genealogy completeness.
- Order/work states permit only valid transitions.
- Quantity/UOM conversions are exact-version and rounding-aware.
- Closed period/transaction rules coordinate with Finance.
- Sensitive/dangerous operational commands require step-up/SoD/approval.
- Every adjustment, scrap, write-off, override and backdate has reason/evidence.
- Reconciliation ties physical/operational subledgers to Finance with zero unexplained critical variance.

## 17. Frontline and operations UX

Required experiences:

- Operations command center: exceptions, queues, commitments, bottlenecks and site health.
- Product/item/master workbench.
- Order/fulfillment workspace.
- Inventory and warehouse mobile/scanner flows.
- Production dispatch and supervisor board.
- Quality inspection/nonconformance/CAPA.
- Maintenance planner/technician mobile.
- Project/service/field workspaces.
- Logistics tracking and exception management.
- Site/facilities operations.

Design for gloves/scanners/noisy environments where applicable, fast repetitive entry, large touch targets, keyboard/scanner shortcuts, clear quantity/UOM/location, offline state, confirmation only for consequential actions and minimal modal friction. All views provide source/freshness, permission, audit and accessibility alternatives.

## 18. Institutional-memory superiority

- Work centers, production lines, assets, sites, warehouses, projects, suppliers, customers, items and durable operating seats retain eligible decisions, exceptions, fixes, calibrations, setup knowledge, handoffs and runbooks.
- Shift/role transitions surface open work, abnormalities, temporary controls and recent changes.
- Relay answers “what usually fails here?”, “why is this order late?”, and “how was this asset repaired?” using authorized cited records.
- Personal/private worker data and protected customer information remain scoped.

## 19. Relay in Operations

Allowed: summarize exceptions, propose schedules/allocations, draft work instructions, explain genealogy/late order, extract inspection results, suggest known fixes, prepare shift handoff and simulate alternatives.

Protected or prohibited: no autonomous unsafe machine action, quality release, recall closure, inventory write-off, shipment of controlled goods, maintenance safety clearance, customer promise or financial approval. Typed tools, policy and human approval apply.

## 20. Integration and real-time architecture

Use the Integration Plane for PLM/CAD, MES, QMS/LIMS, WMS/TMS/carriers, EDI/supplier networks, ecommerce/POS, IoT/historian, equipment, scanning/RFID and external ERP. Ingest observations with event time, source, sequence, quality and replay handling. Do not promise hard real-time safety/control latency on ordinary cloud workflows.

## 21. Performance, scale and reliability

- Partition by tenant/cell/site/item/order/workload while preserving transaction boundaries.
- Concurrency-safe inventory reservation and work allocation.
- High-volume event ingestion with backpressure and late/out-of-order handling.
- Bulk jobs/checkpoints, wave processing and safe cancellation.
- Offline sync with bounded data and deterministic conflicts.
- Site/cell degradation modes that preserve safety and accounting integrity.
- Define SLOs for order, inventory, warehouse, production, service, mobile and integration flows.

## 22. Best-system scorecard

Measure:

- perfect-order/on-time-in-full and promise accuracy;
- inventory accuracy, stockout, aging and adjustment rate;
- warehouse task time/error and throughput;
- schedule adherence, yield, scrap, OEE data quality and production variance;
- quality escape, nonconformance/CAPA cycle and traceability completeness;
- asset uptime, MTBF/MTTR, planned maintenance and repeat failure;
- project schedule/cost variance and utilization;
- first-time fix, response/resolution and field productivity;
- exception detection-to-resolution and successor/shift handoff time;
- operational-to-Finance unexplained variance;
- frontline task success, training time, accessibility and offline reliability;
- configuration-to-live time, integrations, support burden and cost per transaction;
- benchmarked public workflows against SAP/Oracle/Infor/IFS/Epicor and Intuit Enterprise Suite Construction without copied trade dress. Intuit scenarios must cover multi-entity project/job operations, job costing, project profitability, workforce/time/payroll connection, cash flow and ease of deployment.

## 23. Required E2E scenarios

1. Forecast/order demand → planning recommendation → purchase/production supply → fulfillment → Finance.
2. Purchase order/ASN → receiving/quality/putaway → invoice match.
3. Sales order → promise/reserve/pick/pack/ship/deliver/return/bill.
4. Discrete work order with BOM/routing/lot-serial genealogy/cost variance.
5. Batch/process run with formula, yield, co-product and quality hold.
6. Quality nonconformance → quarantine → CAPA → disposition/recall.
7. Preventive maintenance → parts/labor → completion → cost/asset history.
8. Project/services execution → time/expense/deliverable → bill/revenue.
9. Field service offline → sync conflict → customer acceptance → billing.
10. EDI/carrier/provider outage and reconciled recovery.
11. Shift/role transition using institutional memory.
12. Multi-site load, failover, restore and financial reconciliation.

## 24. Evidence-gated checklist

### OPS-000 — Foundation

- [ ] OPS-000-001 — Inventory current operations/inventory/project/event code and false claims.
- [ ] OPS-000-002 — Implement shared product/site/item/UOM/order/supply/inventory/work/asset/project/service models.
- [ ] OPS-000-003 — Implement state machines, idempotency, concurrency and operational event contracts.
- [ ] OPS-000-004 — Import every `OPS-*` item into the canonical ledger.
- [ ] OPS-GATE-000 — Operational foundation preserves quantities, state and tenant isolation.

### OPS-010 — Supply, inventory, warehouse and orders

- [ ] OPS-010-001 — Implement demand/supply/reservation/availability and approved plan handoff.
- [ ] OPS-010-002 — Implement inventory transactions, lot/serial/genealogy and valuation events.
- [ ] OPS-010-003 — Implement warehouse inbound/storage/work/outbound/count flows.
- [ ] OPS-010-004 — Implement order orchestration, fulfillment, returns and billing events.
- [ ] OPS-GATE-010 — Supply-to-fulfillment works and reconciles.

### OPS-020 — Manufacturing, quality and assets

- [ ] OPS-020-001 — Implement product structure/routing and declared manufacturing modes.
- [ ] OPS-020-002 — Implement work execution, WIP, yield/scrap/rework and accounting events.
- [ ] OPS-020-003 — Implement inspection/nonconformance/CAPA/traceability/recall.
- [ ] OPS-020-004 — Implement maintenance/assets/calibration/spares and Finance link.
- [ ] OPS-GATE-020 — Product and asset operations are traceable and controlled.

### OPS-030 — Projects, service, logistics and facilities

- [ ] OPS-030-001 — Implement project/resource/time/cost/deliverable/change execution.
- [ ] OPS-030-002 — Implement service/field/dispatch/mobile/offline/acceptance.
- [ ] OPS-030-003 — Implement shipment/carrier/tracking/delivery/freight boundary.
- [ ] OPS-030-004 — Implement facility/space/workplace/site operations for declared scope.
- [ ] OPS-GATE-030 — Service-, project-, network- and site-centric operations work.

### OPS-040 — UX, memory, Relay and integrations

- [ ] OPS-040-001 — Deliver command centers and frontline/mobile/scanner experiences with WCAG 2.2 AA.
- [ ] OPS-040-002 — Implement object/site/seat/shift operational memory and handoff.
- [ ] OPS-040-003 — Implement safe Relay tools and safety/approval boundaries.
- [ ] OPS-040-004 — Certify enabled PLM/MES/QMS/LIMS/EDI/WMS/TMS/carrier/IoT connectors.
- [ ] OPS-040-005 — Pass offline, provider-outage, late-event and reconciliation tests.
- [ ] OPS-GATE-040 — Operations is usable, memory-first and integration-resilient.

### OPS-050 — Global, reliability and superiority

- [ ] OPS-050-001 — Implement industry/mode/jurisdiction exact availability and safety disclaimers.
- [ ] OPS-050-002 — Pass all twelve E2E scenarios with zero unexplained critical quantity/money variance.
- [ ] OPS-050-003 — Pass high-volume/concurrency/cell-failure/backup/restore/DR tests.
- [ ] OPS-050-004 — Instrument scorecard baseline/targets/results and competitor workflow benchmarks.
- [ ] OPS-050-005 — Publish exact industry/mode/site/device/provider limitations.
- [ ] OPS-GATE-050 — “Best” is claimed only for measured released scope.

## 25. Definition of done

Operations is done only for exact scopes when master data, supply/inventory/order/warehouse, manufacturing/quality/assets, projects/service/logistics/facilities, mobile/offline, integrations, Finance/Planning/People handoffs and institutional memory work end to end with proven accuracy, scale, security, accessibility and recovery.

## 26. Prohibited shortcuts

Do not use CRUD screens as proof of operations; allow duplicate/negative quantity effects; lose lot/serial lineage; write Finance journals directly; promise hard real-time safety control; let Relay release quality/recall/safety actions; make external PLM/MES schemas canonical; hide offline conflicts; hard-code industry rules; or claim best without operational metrics.

## 27. Required final Claude response

Report exact operations modes/sites/industries/providers, quantity/cost/reconciliation evidence, E2E flows, mobile/offline and performance results, safety boundaries, tests/failures/skips, deployments, limitations, blockers and rollback/restore proof.

## END CLAUDE CODE MASTER PROMPT

---

## Reference anchors

- Oracle SCM and Manufacturing scope: <https://docs.oracle.com/en/cloud/saas/supply-chain-and-manufacturing/25d/books.html>
- Oracle inventory reservation semantics: <https://docs.oracle.com/en/cloud/saas/supply-chain-and-manufacturing/26b/faiom/guidelines-for-reserving-inventory.html>
- Oracle maintenance/material planning relationship: <https://docs.oracle.com/en/cloud/saas/supply-chain-and-manufacturing/25d/fausp/plan-demands-from-maintenance-work-orders.html>
- SAP ERP/SCM scope: <https://www.sap.com/resources/what-is-erp>
- Intuit Enterprise Suite Construction: <https://quickbooks.intuit.com/r/news/intuit-launches-new-ai-powered-intuit-enterprise-suite-for-construction/>
