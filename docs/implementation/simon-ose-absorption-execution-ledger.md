# Simon OSE Tenant #1 absorption — execution ledger

The authoritative record of what has actually been implemented against the Simon
absorption bible, with evidence.

**Source of the checklist:**
[`Tenure_Simon_OSE_Tenant_Absorption_and_Global_Update_Inheritance_Claude_Bible_v1.0.md`](./Tenure_Simon_OSE_Tenant_Absorption_and_Global_Update_Inheritance_Claude_Bible_v1.0.md)
**Source repository being absorbed:** `Tenurework/Tenure`
**Target:** this repository
**Pilot target:** Fall 2026

Created 2026-08-02, on the bible's own instruction (§3: "Create
`docs/implementation/simon-ose-absorption-execution-ledger.md` and copy every
`SIMON-*` item into it.").

## Why this is a separate file from the global engine ledger

Three binding prompts each name their own ledger path in an imperative sentence,
so there are three files. That is a split *record*, not a split queue —
`tools/loop/next-batch.mjs` reads all three into one map and computes a single
answer to "what is next".

## Rules this ledger is kept under

The same rules as the global engine ledger, plus one the absorption adds.

1. An item stays `- [ ]` until it is 100% implemented **for its stated scope**.
2. `- [x]` requires: integrated into the actual runtime, mandatory tests passing,
   required resources deployed in an allowed environment, and evidence recorded.
3. A schema, interface, mock, component, IaC declaration or unrun test does not
   qualify.
4. Final statuses are `PASS`, `FAIL`, `BLOCKED_EXTERNAL`, `NOT_APPLICABLE`.
   **There is no final `PARTIAL`.** Unfinished is unchecked and `FAIL`.
5. A phase gate stays unchecked until every required child is checked or validly
   `BLOCKED_EXTERNAL`.
6. Baseline failures are recorded separately from new ones.
7. No credentials, tokens, raw customer data or secret-bearing output as evidence.
8. **Nothing recorded here may contain Simon student, staff, or applicant data.**
   `Tenurework/Tenure` carries a live pilot's real records. This repository is
   public, and everything a workflow prints is world-readable and archived. Row
   counts, table names and schema shapes are evidence; a single real row is not,
   whatever it is being used to demonstrate.

## Two constraints that govern every item below

**`Tenurework/Tenure` is never pushed to.** A push to its `main` builds a
container, applies Terraform and rolls production ECS for a live pilot carrying
real student data. It remains the rollback source until cutover completes. Where
an item requires a change there, it is a pull request for a human to merge.

**Absorption is not a fork.** The bible's §1: Simon is Tenant #1, "never the
global data model, default terminology, authorization model, AWS topology,
workflow ceiling, or product navigation". An item is not complete if it was
satisfied by an `if (tenant === "simon")` branch in core business logic, a
duplicated core module, or a Simon-only pipeline — those are the specific
failures §2 names, and each is what this ledger exists to make visible rather
than convenient.

---

- [ ] **SIMON-GATE-000** — No import or destructive refactor begins until the two codebases, deployed resources, data, and behavioral gaps are evidence-backed.
  - Status: FAIL
  - Reason: imported from `docs/implementation/Tenure_Simon_OSE_Tenant_Absorption_and_Global_Update_Inheritance_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **SIMON-GATE-010** — One coherent Parent runtime can represent Simon without Simon-aware core business logic.
  - Status: FAIL
  - Reason: imported from `docs/implementation/Tenure_Simon_OSE_Tenant_Absorption_and_Global_Update_Inheritance_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **SIMON-GATE-020** — Simon's complete intended behavior is a reproducible tenant package, not a fork or collection of environment variables.
  - Status: FAIL
  - Reason: imported from `docs/implementation/Tenure_Simon_OSE_Tenant_Absorption_and_Global_Update_Inheritance_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **SIMON-GATE-030** — People may rotate or hold multiple scoped assignments while authorization and institutional memory remain correct over time.
  - Status: FAIL
  - Reason: imported from `docs/implementation/Tenure_Simon_OSE_Tenant_Absorption_and_Global_Update_Inheritance_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **SIMON-GATE-040** — Every Simon user resolves to one governed Tenure identity and exact effective assignments without shared passwords or frontend-only authority.
  - Status: FAIL
  - Reason: imported from `docs/implementation/Tenure_Simon_OSE_Tenant_Absorption_and_Global_Update_Inheritance_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **SIMON-GATE-050** — Every required Simon pilot capability exists in the Parent runtime or has an explicit approved blocker; no hidden dependency remains in the source application.
  - Status: FAIL
  - Reason: imported from `docs/implementation/Tenure_Simon_OSE_Tenant_Absorption_and_Global_Update_Inheritance_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **SIMON-GATE-060** — Migrated Simon data is complete, explainable, authorized, reconciled, restartable, and traceable to immutable source evidence.
  - Status: FAIL
  - Reason: imported from `docs/implementation/Tenure_Simon_OSE_Tenant_Absorption_and_Global_Update_Inheritance_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **SIMON-GATE-070** — Simon is a managed Parent tenant with complete desired/actual resource ownership, not a separately deployed application hidden behind the same UI.
  - Status: FAIL
  - Reason: imported from `docs/implementation/Tenure_Simon_OSE_Tenant_Absorption_and_Global_Update_Inheritance_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **SIMON-GATE-080** — Relay makes Simon's seat memory useful without creating a second authorization or truth system.
  - Status: FAIL
  - Reason: imported from `docs/implementation/Tenure_Simon_OSE_Tenant_Absorption_and_Global_Update_Inheritance_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **SIMON-GATE-090** — Simon is fully converged on the Parent experience while remaining recognizably configured for its organization and terminology.
  - Status: FAIL
  - Reason: imported from `docs/implementation/Tenure_Simon_OSE_Tenant_Absorption_and_Global_Update_Inheritance_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **SIMON-GATE-100** — Future global releases automatically include Simon in compatibility evaluation and governed rollout through the one Parent release train.
  - Status: FAIL
  - Reason: imported from `docs/implementation/Tenure_Simon_OSE_Tenant_Absorption_and_Global_Update_Inheritance_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **SIMON-GATE-110** — All pilot-critical business journeys, denial paths, transitions, failure paths, and generality proofs pass in staging.
  - Status: FAIL
  - Reason: imported from `docs/implementation/Tenure_Simon_OSE_Tenant_Absorption_and_Global_Update_Inheritance_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **SIMON-GATE-120** — Simon production activates on Parent only through an evidence-backed, approved, rehearsed, and reversible cutover.
  - Status: FAIL
  - Reason: imported from `docs/implementation/Tenure_Simon_OSE_Tenant_Absorption_and_Global_Update_Inheritance_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **SIMON-GATE-130** — Simon is stable on Parent, support ownership is transferred, and the old system no longer receives traffic, writes, secrets, or recurring cost except explicitly approved retention.
  - Status: FAIL
  - Reason: imported from `docs/implementation/Tenure_Simon_OSE_Tenant_Absorption_and_Global_Update_Inheritance_Claude_Bible_v1.0.md`; not yet implemented
