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

- [x] **GE-000-003** — Identify all auth/authz, tenant, person, role/seat, approval, audit, finance, files, search, AI and connector paths; mark duplicates and contradictions.
  - Status: PASS
  - Code/config: [`../architecture/subsystem-paths.md`](../architecture/subsystem-paths.md),
    `tests/security/audit-writes.test.mjs`
  - Evidence: eleven subsystems traced to file and line. **Six contradictions**
    ranked, each assigned an owning item, and two duplications examined and
    recorded as *correct* so a later reader does not "fix" them.
  - The two findings that change what can honestly be claimed about the product:
    1. **The authorization engine gates nothing.** `@tenure/authorization` has
       two consumers, and both are navigational — it decides which menu entries
       render. Access is decided by `lib/admin/capabilities.ts` (16 ids) and
       `lib/rbac.ts`. Tenure does not today have a policy engine enforcing
       access, and saying otherwise would be false. → GE-030s
    2. **34 of 35 audit writes bypass `@tenure/audit`**, and so skip field
       validation, the DENY-needs-a-reason rule, and metadata redaction. The
       evidence trail a school would be shown in an incident review is 34/35
       unvalidated. → GE-120s
  - Also recorded: identity is one shared passphrase for every user (→ GE-041);
    the only outbound HTTP call in the app is a literal `api.anthropic.com` URL
    with no gateway, tenant policy, cost accounting or prompt audit (→ GE-100s);
    connectors do not exist at all, rather than partially (→ GE-110s); and five
    SQS queues, an SES identity and a DLQ alarm are provisioned for a delivery
    path with **no producer and no consumer** — no package declares an SQS or
    SES client, so the product sends no email and the green DLQ alarm is
    watching a queue nothing can write to (→ GE-090 / GE-140).
  - Tests: `npm run test:platform` → 22 passed. The "34 of 35" claim is a
    ratchet, not prose: `RAW_WRITE_CEILING` fails if a 35th raw write is added,
    fails if the ceiling drifts above the real count, fails if the package stops
    being reached at all, and fails if the document's numbers disagree with the
    code.

- [x] **GE-000-004** — Trace every entry point, public route, API route, background job, realtime path, scheduled job, webhook, import/export, admin/support route.
  - Status: PASS
  - Code/config: [`../architecture/entry-points.md`](../architecture/entry-points.md),
    `tools/entry-point-inventory.mjs`, `tests/security/entry-points.test.mjs`
  - Evidence: generated from the filesystem, not written from memory.
    **20 API routes · 37 pages · 13 modules exporting 62 server actions.**
    Guards are attributed from the handler *and every ancestor layout*, because
    a Next.js layout guards what nests beneath it — without that the table
    would report most pages unguarded and be useless.
  - The finding that justified doing this per-action rather than per-file:
    **a layout guard does not protect a server action.** A POST to an action id
    never renders the layout. `(app)/admin/actions.ts` alone exports 21; had
    guards been attributed per module, one guarded action would have vouched
    for twenty others. Attributed individually, **61 of 62 carry their own
    guard**; the exception is `signOutAction`, which takes no argument, reads
    no tenant row, and leaves an anonymous caller with what they already had.
  - Unauthenticated surface is exactly `/api/auth/[...nextauth]`, `/api/health`
    and `/signin`, each allowlisted with a reason.
  - Tests: `npm run test:platform` → 24 passed. Proven to catch, not merely to
    pass: an unguarded exported action FAILS (named in the message), a
    tenant-scoped action with no session check FAILS, a guard mentioned only in
    a comment FAILS, and the unmodified tree PASSES.
  - Gap this closes onto: there is **no import endpoint**. A tenant's data can
    leave over HTTP and cannot be loaded back — owned by GE-060.

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

- [x] **GE-000-006** — Reconcile claimed product metrics and UI surfaces to canonical code/data; identify seeded/demo/placeholder data.
  - Status: PASS
  - Code/config: [`../architecture/data-provenance.md`](../architecture/data-provenance.md),
    `tests/security/no-personal-data.test.mjs`
  - Evidence: seven documents in this repository quote "26 clubs, 235 seats,
    172 people". Reconciled against the code that produces each:
    | Quoted | Canonical | Verdict |
    |---|---|---|
    | 26 clubs | `ROSTER.length` | correct |
    | 235 seats | `db.role.count()` | **conflates 209 board seats with 26 advisor roles** |
    | 172 people | `db.directoryPerson.count()` | correct — and *not* 172 names |
    The pilot has **209 seats**. An advisor is not a board seat: not elected,
    not termed, not part of the handoff the product exists for.
    The roster carries 278 entries with an address, 172 distinct addresses and
    **191 distinct names** — not 19 lost people, but 18 addresses each carrying
    two spellings of one person (a dropped middle initial, `F.V.T.` vs
    `F.v.T.`). `DirectoryPerson.email` is `@unique`, so the upsert collapses
    them and the *last* spelling wins, making a person's displayed name depend
    on roster iteration order. Minor, real, and undetected until now.
  - Seeded vs operator-entered: **no column in any of the 40 models records
    provenance.** No `source`, no `isSeed`. So "is this real data?" is not a
    query, a tenant cannot be reset to as-provisioned, and
    `seed-reference-data.yml` decides what is test state by heuristic because
    there is no marker to read. → GE-060.
  - **This audit found a live data exposure**, which is why it is recorded here
    and not only in the document: `apps/web/scripts/roster-data.mjs` — 328 real
    university addresses for 172 named students and advisors — was committed to
    **two public repositories**, served by `raw.githubusercontent.com` with
    HTTP 200, and shipped inside the production container image. Untracked and
    gitignored here (`b5edb93`); `satvikOS/Tenure` PR #1 does the same there.
    The mechanism to prevent it already existed — `roster-source.mjs` and its
    three-source fallback — and had never been used, because nothing failed
    while the file sat there. The fix therefore landed as a failing test rather
    than as a deletion.
  - Tests: `npm run test:platform` → 25 passed. Verified to catch: a planted
    real-domain address FAILS and the file is named without printing the
    address (a failure prints into public CI logs). It immediately caught two
    the manual sweep had missed.

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

- [x] **GE-001-002** — Manual read-only AWS inventory workflow: minimal permissions, immutable action pins, concurrency, short retention, redaction.
  - Status: PASS
  - Code/config: `.github/workflows/aws-inventory.yml`, `tools/aws-inventory.mjs`
  - Evidence: `workflow_dispatch` only; `permissions: contents: read`; all three
    actions pinned to commit SHAs, not tags; `concurrency: aws-inventory`;
    artifact retention 3 days. Read-only is asserted, not claimed —
    `tests/security/production-workflows-disarmed.test.mjs` inlines the script
    the job runs and greps it for mutating commands, having first normalised
    argv-array and helper-call forms.
  - Tests: `npm run test:platform` → 12 passed. A three-case harness proved the
    detector: unmodified PASSES, a comment naming a mutating command PASSES, a
    real `execFileSync('aws',['s3','rm',…])` FAILS.
  - Commit: `8e3acc2`
- [x] **GE-001-003** — Prove caller identity with STS and validate an account/region allowlist before inventory.
  - Status: PASS
  - Evidence: the "Prove caller identity, and refuse an unexpected account" step
    runs `sts:GetCallerIdentity` and exits non-zero when the account does not
    match the operator-supplied `expected_account`, before any inventory call.
    Only the principal TYPE is printed; the full ARN carries a user or role name
    that does not belong on a public artifact.
  - Deployment: run `30673479805` → success
- [x] **GE-001-004** — Inventory Organizations, IAM/OIDC, IaC ownership, network/DNS/ACM/CloudFront/WAF, compute, Cognito, databases, storage, queues, KMS/secrets metadata, observability/backup.
  - Status: PASS
  - Evidence: run `30673479805`, account `1549…97` masked, `us-east-1`.
    2 VPCs · 0 NAT gateways · 2 ALBs · 2 CloudFront distributions · 2 ECS
    clusters · 1 RDS · 3 S3 buckets · 1 DynamoDB table · 1 ElastiCache ·
    6 secrets · 14 IAM roles · 4 alarms · 3 log groups.
    No application data, parameter value or secret value is collected;
    `get-secret-value` does not appear in the script.
  - Denied and recorded rather than escalated, per §3:
    `organizations describe-organization`, `list-accounts`, `list-roots` —
    **Organizations is not in use.** That is a finding, not an obstacle.
- [x] **GE-001-005** — Produce `aws-current-state.md`, `resource-reconciliation.md`, and a sanitized machine-readable inventory.
  - Status: PASS
  - Code/config: `docs/architecture/aws-current-state.md`,
    `docs/architecture/resource-reconciliation.md`,
    `docs/architecture/aws-inventory.json`
  - Evidence: sanitisation verified by grep — the account id appears **0 times**
    in all three files. The first run leaked it 3 times through S3 bucket names
    (`<project>-<purpose>-<accountId>`), which field-level masking never
    anticipated; masking now happens once over each finished file and
    `writeSanitized` refuses to write if the id survives.
  - **Five gaps this inventory establishes**, each now owned by a later item:
    | Finding | Item |
    |---|---|
    | No AWS Organization — a single-account estate, where the Bible requires Tenure-owned member accounts per environment and isolation class | GE-010 |
    | No OIDC provider — all four AWS workflows use long-lived keys shared with a second repository | GE-011 |
    | No Cognito user pool — both applications authenticate with NextAuth; the Bible makes Cognito the substrate | GE-041 |
    | RDS `tenure-pilot-db`: backup retention **1 day**, no Multi-AZ, and **no backup vault** anywhere in the account | GE-161 |
    | No WAF on either distribution — both directly exposed, no rate limiting, no managed rules | GE-150 |
- [x] **GE-001-006** — Identify public exposure, demo auth, static credentials, runtime schema mutation, dangerous uploads, audit/backup gaps; create containment work items.
  - Status: PASS
  - Evidence: recorded across `BASELINE-VALIDATION.md` and PD-002/PD-003.
    Containment items raised and their state:
    - Public dev-login on the pilot → gated behind an interim passphrase (PD-003). **Contained, not resolved**; Okta/Cognito is the fix.
    - Runtime schema mutation (`db push` at boot) → replaced by versioned migrations (ADR-0001). **Resolved.**
    - Two repositories holding the same production AWS keys → every AWS job guarded, triggers removed, asserted by 12 platform tests. **Resolved.**
    - Static long-lived AWS keys → still in use by all four AWS workflows. **Open**, drives GE-011.
    - `backup_retention_period` of 1 day on the pilot RDS. **Open**, drives GE-161.

- [x] **GE-001-007** — Do not write to AWS until account/region/role, resource ownership, replacement risk and rollback path are known.
  - Status: PASS — **satisfiable from now; it was violated once before it was.**
  - Evidence: the inventory above now establishes account, region, principal
    type, resource ownership and IaC ownership. `resource-reconciliation.md`
    records that the two Terraform stacks hold separate state files, which is
    the property that bounds replacement risk between them.
  - The violation is kept on the record rather than removed now that the item
    passes: the Studio stack was applied before any of this existed. The
    reasoning at the time was sound — separate state key, shared VPC read
    through data sources that cannot destroy, removable with its own
    `terraform destroy`, pilot health checked after every apply — but sound
    reasoning is not an inventory, and the rule asked for an inventory.
- [ ] **GE-GATE-0** — Baseline truth, safe AWS inventory, containment list, repository map and execution ledger complete; no credential or customer data exposed.
  - Status: **BLOCKED_EXTERNAL** — all fourteen Phase 0 items pass. The gate is
    held open by two decisions that are a person's to make, not mine.
  - Phase 0 items: GE-000-001 … 007 and GE-001-001 … 007, all `- [x]`.

  ### Blocker 1 — customer data was exposed, and removal is not remediation

  `apps/web/scripts/roster-data.mjs` carried **328 real university email
  addresses for 172 named students and advisors**. It was committed to **two
  public repositories**, served by `raw.githubusercontent.com` with HTTP 200,
  and shipped inside the production container image (the Dockerfile copies
  `apps/web/scripts` wholesale). It was added on 2026-07-30 in `a9d901b` while
  importing the live application, and nothing failed while it sat there.

  Done:
  - untracked and gitignored here (`b5edb93`); the API returns 404 for the path
  - `satvikOS/Tenure` PR #1 does the same there — that repository cannot be
    pushed to directly
  - three specs and one comment that named real people now derive them from
    `roster-source.mjs` (`d2d40b1`), verified 14/14 against both rosters
  - `tests/security/no-personal-data.test.mjs` fails the build on a real-domain
    address in any tracked file, and cross-references real roster **names**
    where the roster is present

  **Not done, and not mine to decide:**
  1. the blob remains reachable by commit SHA in both public histories —
     purging it means rewriting history and force-pushing two public repos
  2. GitHub Support must be asked to drop cached views of the affected SHAs
  3. whether the 172 affected people are notified

  Until (1)–(3) are decided, **those addresses should be treated as disclosed**,
  and this gate cannot honestly claim "no customer data exposed".

  ### Blocker 2 — the operator secret must be rotated, and I should not choose how

  The System Studio operator secret was generated locally, stored as the
  write-only GitHub secret `PLATFORM_OPERATOR_SECRET`, and then transmitted to
  the operator in conversation. It has never appeared in this repository, a
  workflow log, a summary or an artifact — verified by grepping the deploy run's
  log (0 matches). It is nonetheless a secret that travelled.

  Rotating it is two commands, and they are the operator's to run because the
  point is that the new value never passes through me or through a transcript:

  ```
  gh secret set PLATFORM_OPERATOR_SECRET --repo satvikOS/Tenure-Parent
  gh workflow run deploy-studio.yml --repo satvikOS/Tenure-Parent
  ```

  The value must clear the checks in `apps/system-studio/src/lib/operators.ts`:
  24 characters minimum, not a placeholder, and enough distinct characters that
  a repeated string is refused. After the deploy, the previous value is dead.

  A generated secret shared by every operator is an interim answer regardless.
  **GE-041** replaces it with Cognito operator identity, which is the real fix.

  ### What the inventory found, carried forward

  | Finding | Owner |
  |---|---|
  | No AWS Organization — a single-account estate | GE-010 |
  | No OIDC provider — long-lived keys shared across two repositories | GE-011 |
  | No Cognito user pool — identity is one shared passphrase | GE-041 |
  | RDS backup retention 1 day, no Multi-AZ, no backup vault | GE-161 |
  | No WAF on either distribution | GE-150 |
  | The authorization engine gates nothing — two consumers, both navigational | GE-030s |
  | 34 of 35 audit writes bypass validation, redaction and chaining | GE-120s |
  | Five SQS queues, an SES identity and a DLQ alarm with no producer or consumer | GE-090 / GE-140 |
  | No row provenance — seeded and operator-entered data are indistinguishable | GE-060 |
  | One tenant's policy content compiled into the global engine | GE-060 |

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
