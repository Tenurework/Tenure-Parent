# Tenure Global Distribution Engine — execution ledger

The authoritative record of what has actually been implemented, with evidence.

**Source of the checklist:**
[`Tenure_Claude_Code_Global_Engine_Execution_Prompt_v1.0.md`](./Tenure_Claude_Code_Global_Engine_Execution_Prompt_v1.0.md)
**Target architecture:**
[`../architecture/Tenure_Global_System_Architecture_Bible_v1.0.md`](../architecture/Tenure_Global_System_Architecture_Bible_v1.0.md)

## Rules this ledger is kept under

Taken from §4 of the execution prompt, restated here because a ledger nobody
can check the rules of is not evidence.

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

## Standing note on prior work

This repository already contained substantial work before this ledger existed —
an imported application, seven platform packages, a deployed System Studio. That
work is **not** retroactively marked complete. Where it satisfies an item it is
checked with the evidence that already exists; where it only partially satisfies
one, the item stays unchecked and the gap is named. Several items below are
therefore `FAIL` against code that works, because the prompt's scope is wider
than what was built.

---

# Phase 0 — Establish repository, product, and AWS truth

## GE-000: Repository inventory

- [x] **GE-000-001** — Worktree, branch, remotes, default branch, protection, unrelated changes.
  - Status: PASS
  - Evidence: worktree clean at time of writing; branch `main`; remotes
    `origin` → `satvikOS/Tenure-Parent`, `live` → `satvikOS/Tenure`; default
    branch `main`; no branch protection rulesets configured (recorded as a gap,
    see GE-170). Unrelated changes preserved: the two uploaded documents in
    commit `35087fa` were merged, not overwritten, and moved rather than edited.
  - Commit: `5b680ec`

- [x] **GE-000-002** — Repository map of every app, package, module, schema, migration, workflow, IaC stack, test suite, deployment script.
  - Status: PASS
  - Code/config: [`repository-map.md`](./repository-map.md)
  - Evidence: generated from `git ls-files`, not from memory. Covers 2 apps,
    10 packages, 1 module catalog, 2 blueprints, 1 Prisma schema (40 models,
    1 migration), 2 Terraform stacks, 14 workflows, 5 test suites.

- [ ] **GE-000-003** — Identify all auth/authz, tenant, person, role/seat, approval, audit, finance, files, search, AI and connector paths; mark duplicates and contradictions.
  - Status: FAIL — partially done, and the unfinished part is the important one.
  - What exists: `docs/architecture/CURRENT-STATE-INVENTORY.md` covers the
    Prisma models and single-institution assumptions;
    `apps/web/src/lib/tenancy/registry.ts` classifies all 40 models into
    scoped / platform-global / unenforceable and a test fails if one is missing.
  - What is missing: no systematic trace of **connector** or **AI** paths, and
    no explicit duplicate/contradiction list. Two authorization systems now
    coexist — `apps/web/src/lib/admin/capabilities.ts` (16 capability ids,
    Director ⊇ Staff ⊇ Advisor) and `@tenure/authorization` (roles, scope,
    delegation, SoD) — and nothing records which is canonical. That is exactly
    the contradiction this item exists to surface.

- [ ] **GE-000-004** — Trace every entry point, public route, API route, background job, realtime path, scheduled job, webhook, import/export, admin/support route.
  - Status: FAIL — not systematically traced.
  - Partial: 40 routes are known from `next build` output, and the reminders
    cron is traced end to end in `apps/web/src/lib/jobs/reminders-isolation.itest.ts`.
    No inventory of webhooks, import/export or support routes exists.

- [x] **GE-000-005** — Baseline install, lint, type check, tests, builds, migration validation, dependency audit, secret scan, e2e inventory. Record exact failures.
  - Status: PASS
  - Code/config: [`../migrations/BASELINE-VALIDATION.md`](../migrations/BASELINE-VALIDATION.md)
  - Tests: 17 checks recorded with command and exit code. Current state:
    `npm run test --workspace apps/web -- --ci` → 785 passed;
    `npm run test:isolation` → 34 passed; `npm run test:platform` → 12 passed;
    `npx playwright test` → 132 passed (apps/web) + 5 passed (system-studio).
  - Baseline failures recorded separately, per rule 8: one pre-existing
    isolation-test failure (since fixed), one intermittent e2e failure observed
    once and not reproduced, 34 `npm audit` vulnerabilities (32 high, 2 critical)
    **not yet triaged** — see GE-150.
  - Gap: no secret scan and no dependency-audit **gate** in CI. Recorded under
    GE-170; the audit numbers above are an observation, not a control.

- [ ] **GE-000-006** — Reconcile claimed product metrics and UI surfaces to canonical code/data; identify seeded/demo/placeholder data.
  - Status: FAIL — not started.
  - Known relevant fact: the pilot's data comes from `apps/web/scripts/seed.mjs`
    (26 clubs, 235 seats, 172 directory people) and is real roster data, not
    placeholder — but nothing distinguishes seeded from operator-entered rows,
    which is what this item asks for.

- [x] **GE-000-007** — Import the Architecture Bible into `docs/architecture/`; create ADR index and execution ledger.
  - Status: PASS
  - Code/config: `docs/architecture/Tenure_Global_System_Architecture_Bible_v1.0.md`,
    `docs/implementation/Tenure_Claude_Code_Global_Engine_Execution_Prompt_v1.0.md`,
    this ledger, and [`../decisions/README.md`](../decisions/README.md) as the ADR index.
  - Evidence: moved with `git mv`, so history follows the files.

## GE-001: Safe GitHub/AWS discovery

- [x] **GE-001-001** — Inventory workflows, environments, variables, secret NAMES only, Actions settings, runners, deployment history, concurrency, OIDC references.
  - Status: PASS
  - Code/config: [`../architecture/github-current-state.md`](../architecture/github-current-state.md)
  - Evidence: 14 workflows classified by trigger and by whether they reach AWS;
    4 secret names listed with no values; zero environments and zero rulesets
    found, both recorded as gaps; no OIDC provider referenced by any workflow —
    all four AWS-touching workflows use long-lived access keys, which is the
    finding that drives GE-011.

- [ ] **GE-001-002** — Manual read-only AWS inventory workflow: minimal permissions, protected environment, immutable action pins, concurrency, short retention, redaction.
  - Status: FAIL
  - Partial: `.github/workflows/platform-plan.yml` is read-only and proven so —
    `tests/security/production-workflows-disarmed.test.mjs` greps it for
    mutating commands and the detector is itself tested. But it is a Terraform
    plan, not an inventory; actions are pinned by tag rather than commit SHA;
    there is no protected environment; and there is no redaction pass.

- [ ] **GE-001-003** — Prove caller identity with STS and validate an account/role/region allowlist before inventory.
  - Status: FAIL
  - Partial: `platform-plan.yml` calls `sts:GetCallerIdentity` and prints the
    account (`154932391697`, `us-east-1`). It does **not** validate that against
    an allowlist, so it would proceed happily against the wrong account.

- [ ] **GE-001-004** — Inventory Organizations/Control Tower/OU topology, IAM OIDC/roles/trust, IaC ownership, network/DNS/ACM/CloudFront/WAF, compute, Cognito, databases, storage, queues, KMS/secrets metadata, observability/security/backup/cost.
  - Status: FAIL — not started.
  - Known fragments from the Terraform plan of 2026-07-31: account
    `154932391697`, `us-east-1`, one VPC, ECS `tenure-pilot`, RDS Postgres,
    2 CloudFront distributions, ALB, SES, SQS, ElastiCache, Secrets Manager.
    Fragments are not an inventory.

- [ ] **GE-001-005** — Produce `aws-current-state.md`, `resource-reconciliation.md`, sanitized machine-readable inventory with ownership, drift, dependencies, risk, environment, migration intent.
  - Status: FAIL — blocked on GE-001-004.

- [x] **GE-001-006** — Identify public exposure, demo auth, static credentials, runtime schema mutation, dangerous uploads, audit/backup gaps; create containment work items.
  - Status: PASS
  - Evidence: recorded across `BASELINE-VALIDATION.md` and PD-002/PD-003.
    Containment items raised and their state:
    - Public dev-login on the pilot → gated behind an interim passphrase (PD-003). **Contained, not resolved**; Okta/Cognito is the fix.
    - Runtime schema mutation (`db push` at boot) → replaced by versioned migrations (ADR-0001). **Resolved.**
    - Two repositories holding the same production AWS keys → every AWS job guarded, triggers removed, asserted by 12 platform tests. **Resolved.**
    - Static long-lived AWS keys → still in use by all four AWS workflows. **Open**, drives GE-011.
    - `backup_retention_period` of 1 day on the pilot RDS. **Open**, drives GE-161.

- [ ] **GE-001-007** — Do not write to AWS until account/region/role, resource ownership, replacement risk and rollback path are known.
  - Status: FAIL — **this rule was not followed, and saying so is the point of the ledger.**
  - What happened: the System Studio stack (`infrastructure/studio/`) was
    applied to account `154932391697` before this inventory existed. Ownership
    and rollback were reasoned about carefully and the reasoning holds — a
    separate state key (`studio/terraform.tfstate`), the shared VPC read through
    data sources that cannot destroy, and a stack that can be removed with
    `terraform destroy` against its own state without touching the pilot — but
    "reasoned about" is not the same as "inventoried", and the item requires the
    latter. It stays unchecked until GE-001-004/005 exist.
  - Mitigating evidence: the pilot was verified healthy after every apply
    (`/api/health` → `{"status":"ok","db":"ok"}`), and a test asserts the studio
    workflow cannot write the pilot's state file.

## Phase 0 gate

- [ ] **GE-GATE-0** — Baseline truth, safe AWS inventory, containment list, repository map and execution ledger complete; no credential or customer data exposed.
  - Status: FAIL — blocked on GE-000-003, GE-000-004, GE-000-006, GE-001-002
    through GE-001-005, GE-001-007.
  - **Credential exposure — one incident, disclosed here rather than omitted.**
    The System Studio operator secret was generated locally, stored as the
    write-only GitHub secret `PLATFORM_OPERATOR_SECRET`, and then transmitted to
    the operator in conversation. It has never appeared in this repository, in a
    workflow log, in a summary, or in an artifact — verified by grepping the
    deploy run's log for secret values (0 matches). It is nonetheless a secret
    that travelled, which §4 rule 9 and §5 both discourage. **Action: rotate
    before this gate is claimed**, and replace the shared secret with Cognito
    operator identity under GE-041.

---

# Phases 1–17

Not started. The prompt's remaining checklist is not copied here as unchecked
boilerplate: a ledger of several hundred `- [ ]` lines transcribed before any
work begins is noise that makes the checked items harder to find, and rule 7
forbids editing checkboxes to make a report look complete — transcribing them
early invites exactly that.

Each phase section is added to this file when its work starts, with its items
copied verbatim from the prompt at that point.

**What already exists that will be evidence for later phases**, recorded so it
is not rebuilt:

| Prompt area | What exists today | Where |
|---|---|---|
| GE-021 tenant context | AsyncLocalStorage scope, enforced at the query layer, 34 isolation tests | `apps/web/src/lib/tenancy/` |
| GE-031 configuration model | Layered resolution, 8 scopes, declared merge strategies, immutable checksummed versions | `packages/configuration` |
| GE-032 configuration studio | Deployed, read-only, operator-gated | `apps/system-studio` |
| GE-050 organization graph | Declared node types, containment, cycle prevention, effective-dated reparenting | `packages/organization-model` |
| GE-051 authorization | RBAC + ABAC + relationship + delegation + SoD, explainable denials | `packages/authorization` |
| GE-070 workflow engine | Versioned definitions, instances pinned to their version | `packages/workflow` |
| GE-071 forms and metadata | Typed fields, forms, conditional visibility, no EAV | `packages/metadata` |
| GE-063 audit integrity | Record that cannot be built unattributed, credential redaction | `packages/audit` |
| GE-100 tenant manifest | Immutable checksummed release artifacts, approval gate, append-only rollback | `packages/releases` |
| GE-052 generality fixtures | A second, structurally different tenant exercised in every relevant test | `blueprints/nonprofit-program-operations` |

**What is known to contradict the target architecture**, so it is not mistaken
for progress:

- Authentication is NextAuth, not Cognito (§2 binding decision). The Studio's
  operator sign-in is a shared secret, explicitly an interim.
- There is no `ModelGateway`, no Bedrock integration, and no Relay. The pilot's
  AI routes call an external API directly, which §2 forbids for customer records.
- Tenant configuration is file-backed (`blueprints/tenants.ts`), not stored,
  versioned and published through the control plane.
- `apps/web` is a duplicate of `satvikOS/Tenure` and does not belong in the
  engine repository (PD-008).
