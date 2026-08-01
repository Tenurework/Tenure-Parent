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

---

# Phase 1 — Secure AWS organization, accounts, and deployment identity

## GE-010: Tenure-owned landing zone

- [x] **GE-010-001** — ADR for a Tenure-owned AWS Organization and member accounts.
  - Status: PASS
  - Code/config: [`../decisions/ADR-0007-tenure-owned-aws-organization.md`](../decisions/ADR-0007-tenure-owned-aws-organization.md)
  - Evidence: OU model fixed (Security, Log Archive, Infrastructure, Tenure
    Parent, Nonproduction, Production Cells, Dedicated Tenants, Quarantine);
    management account runs nothing; a tenant is never asked for an AWS account
    and a dedicated tenant gets a **Tenure-owned** account vended for it.
  - Status of the ADR itself is *Proposed*, deliberately. Creating an
    Organization fixes its management account forever, moves billing, and needs
    root emails and tax details that are the operator's. Deciding the shape is
    mine; creating it is not.

- [ ] **GE-010-002 … 007** — OUs, Control Tower baseline, SCPs, workload separation, partition abstraction.
  - Status: **BLOCKED_EXTERNAL** on the four decisions ADR-0007 names.

## GE-011: GitHub Actions OIDC

- [x] **GE-011-001** — Reconcile the provider and create least-privilege roles.
  - Status: PASS
  - Code/config: `infrastructure/oidc/` (own state key `oidc/terraform.tfstate`)
  - Evidence: the inventory found **zero** OIDC providers. One provider and
    three roles now exist — read, plan, deploy-engine. Read is
    **ViewOnlyAccess, not ReadOnlyAccess**, because ReadOnlyAccess can read
    secret values and object bodies and the inventory writes to a public
    repository; it carries an explicit Deny on GetSecretValue / GetObject /
    Decrypt / Scan that survives a broader policy being attached later. The
    deploy role can manage IAM roles only under a name prefix — unprefixed, a
    compromised deploy mints an administrator — and is denied RDS,
    Organizations, CreateUser/CreateAccessKey and the pilot's state prefix.

- [x] **GE-011-002** — Restrict trust by repository, environment, ref and audience. Negative tests.
  - Status: PASS
  - Tests: `tests/security/oidc-trust.test.mjs`. Proven to catch, not to pass —
    nine weakenings, each a plausible edit, each caught: StringEquals→StringLike,
    a wildcard subject, deploy rebound to a branch, the aud condition deleted,
    the read role widened, the IAM resource unprefixed, the pilot-state Deny
    removed, 12-hour sessions, a wildcard trust principal.
  - **The finding that only a real run could produce:** GitHub signs this
    repository an *immutable-ID-qualified* subject —
    `repo:satvikOS@228056784/Tenure-Parent@1316219596:ref:refs/heads/main`. A
    policy naming the plain path is refused with "Not authorized to perform
    sts:AssumeRoleWithWebIdentity", which never says what it received. The ID
    form is stricter: the numbers are immutable, so recreating a repository at
    the same path does not inherit the trust.

- [x] **GE-011-003** — Use the existing keys only in a protected one-time bootstrap. Never expose them.
  - Status: PASS
  - Code/config: `.github/workflows/bootstrap-oidc.yml`
  - Evidence: manual only, typed confirmation, STS account allowlist before
    anything runs, plan-by-default with apply behind an explicit input, and a
    check that refuses a plan containing a destroy or a replace — this stack is
    additive, so either would mean drift or the wrong state. No echo, no file,
    no output, no artifact, no `configure export-credentials`. Applied in run
    `30701411608`.

- [x] **GE-011-004** — Switch read workflows to OIDC and prove caller identity and least privilege.
  - Status: PASS
  - Evidence: `aws-inventory.yml` run `30701877182` — green, with
    **`principal type: assumed-role`** in its own output. No long-lived key is
    available to that job. A ratchet in `oidc-trust.test.mjs` lists the fourteen
    workflows still on keys and **may only shrink**.

- [ ] **GE-011-005** — Staging and production behind protected human approval.
  - Status: FAIL — the deploy role's trust names a GitHub environment
    `engine-production` that does not exist yet, so that role currently cannot
    be assumed by anything. That is the intended failure direction, and creating
    the environment with reviewers is the remaining work.

- [ ] **GE-011-006** — Legacy key last-use inventory and an approved disable checklist.
  - Status: FAIL — not started. Deliberately not bundled with GE-011-004:
    surprise-revoking a credential breaks whatever was quietly depending on it.

- [ ] **GE-011-007** — Drift detection for OIDC trust, IAM, action pinning, workflow permissions.
  - Status: FAIL — partially covered statically by `oidc-trust.test.mjs`; no
    detection against what is *deployed*.

- [ ] **GE-GATE-1** — Multi-account baseline and OIDC identity operational; no long-lived key used routinely.
  - Status: FAIL — OIDC identity is operational for the read path, but fourteen
    workflows still use long-lived keys and there is no Organization.

---

# Phase 2 — Monorepo boundaries and common runtime

## GE-020: Architecture boundaries

- [x] **GE-020-001** — Define and enforce module/service ownership across the fourteen platform domains.
  - Status: PASS
  - Code/config: [`../architecture/ownership.md`](../architecture/ownership.md),
    `tools/ownership-map.mjs`, `tests/architecture/ownership.test.mjs`
  - Evidence: all 14 domains the prompt names are declared and every one of the
    **298 source files** across `apps/web/src`, `apps/system-studio/src` and
    `packages/` belongs to **exactly one** — 0 unclaimed, 0 claimed twice.
  - The enforcement is the deliverable, not the table. An orphan is not a
    formatting problem: it means code was added that nobody decided the
    ownership of, which is how a codebase stops having boundaries — one
    unclaimed file at a time, each individually defensible.
  - **Four domains are declared with no code**, rather than omitted, because a
    map showing ten would read as a complete map of a ten-domain system:
    `relay` (→ GE-090s), `billing-metering` (→ GE-160s), and the note on each
    says what exists instead. `lib/ai.ts` is owned by `integrations` rather than
    `relay`, because a single direct vendor call with no gateway, no per-tenant
    policy and no cost accounting is an integration, not a Relay.
  - Tests: 7, proven to catch by mutation — a new file in no domain FAILS, two
    domains claiming one path FAILS, a domain deleted from the map FAILS, a scan
    root removed FAILS (`only 53 files scanned — a root stopped being read`),
    and an unbuilt domain relabelled as built FAILS. Unmodified passes and the
    worktree is clean afterwards.
  - Honest limit: ownership is by path prefix, so it governs where code lives
    rather than what it imports. GE-020-002 is the import-direction half.

- [x] **GE-020-002** — Prevent controllers, UI, connectors and general modules from importing raw database, provider or AWS clients.
  - Status: PASS
  - Code/config: `tests/architecture/forbidden-clients.test.mjs`
  - Evidence: no module outside `lib/db.ts` constructs a Prisma client, none
    outside `lib/s3.ts` and the Studio's `registry.ts` constructs an AWS one,
    and no provider URL is called outside `lib/ai.ts`. **One real violation
    existed and was fixed rather than allowlisted** — the document summary page
    built its own `S3Client` and now reads through `getDocumentBytes`.
  - The rule shipped with a hole an adversarial pass found:
    `import * as p from "@prisma/client"` then `new p.PrismaClient()` passed
    cleanly, because the check searched the import clause for a literal
    identifier that a namespace import never contains. Closed, with
    `import type * as` still correctly ignored.
  - Tests: twelve mutations, each restored — reinstating the original violation
    byte-for-byte, a raw client in a page, a provider URL, an AWS constructor
    with no import, an aliased AWS import, a dynamic
    `await import("@aws-sdk/client-sts")`, owner rot in both adapters, and a
    rogue **untracked** file proving the scan sees uncommitted code.
  - Two limits recorded rather than papered over: the provider rule anchors on
    `https?://` immediately followed by the host, so a host assembled from a
    string constant is not detected; and the AWS constructor pattern matches
    inside string literals, because the same stripper must preserve strings for
    the URL rule.

- [x] **GE-020-003** — Shared contracts for tenant context, commands, queries, domain events, audit, outbox, errors, jobs, idempotency, config, permissions, files, tool registration.
  - Status: PASS
  - Code/config: `packages/contracts/`, `packages/contracts/src/contracts.test.ts`
  - Evidence: all fourteen contracts, each a **runtime gate** rather than an
    erased interface. A TypeScript interface constrains nothing at a module
    boundary — a value arriving from a queue, a job runner or a browser was
    never seen by the compiler that believed it — so every contract has a
    `parseX` that returns the value or throws a `ContractViolation` naming the
    field and the problem.
  - Decisions the contracts make, rather than describe:
    - `Command.expectedVersion` is **required**, with `null` meaning "this is a
      create". Optional concurrency control is concurrency control nobody uses:
      it is omitted at the call site that needs it most, and the lost update is
      found by a customer.
    - A `validation`, `not-found`, `forbidden` or `precondition` error may not
      declare itself retryable — a client told to retry one retries forever.
    - An idempotency key replayed against a **different** request digest is a
      conflict, never the earlier result. Without that, a client reusing a key
      receives the first request's answer and believes the second succeeded.
    - A `FileRef` whose object key does not begin with its tenant id is refused;
      that is the whole failure mode of shared storage.
    - A tool that writes must reauthorize per call, because the permission may
      have been revoked since the session began — and a tool registered with no
      `requiredPermission` is how a retrieval system becomes an exfiltration
      system.
    - A `DENY` needs a reason. "Denied" alone cannot answer the only question
      anyone asks about one.
  - Dependency-free by design — no Prisma, AWS, Next or React. A contract that
    imports the database is the database with extra steps, and it is what lets a
    job runner, an HTTP handler and a queue consumer all speak the same shapes.
  - Tests: 35, and **proven to catch by mutation**. Nine guards were removed one
    at a time and each restored: optional `expectedVersion` FAILS, a retryable
    permanent error FAILS, cross-request replay FAILS, a cross-tenant file key
    FAILS, a writing tool that skips reauthorization FAILS, a reasonless DENY
    FAILS, the page cap removed FAILS, and **two real value-leaks** — `str()`
    reporting the rejected value, and the actorKind refusal naming it — both
    FAIL.
  - One mutation initially passed when it should not have, and the reason is
    recorded because it is the interesting part: it used `arguments[3]`, which
    does not exist on a three-parameter constructor, so it echoed the problem
    string rather than the value and simulated no leak at all. A proof that does
    not reproduce the defect proves nothing; it was replaced with two that do.

- [x] **GE-020-004** — ADR defining the modular-monolith default and objective service-extraction criteria.
  - Status: PASS
  - Code/config: [`../decisions/ADR-0008-modular-monolith-and-extraction-criteria.md`](../decisions/ADR-0008-modular-monolith-and-extraction-criteria.md)
  - Evidence: the default is stated as **where the burden of proof sits**, not as
    a preference, and five extraction criteria are each measurable — a ≥10×
    sustained resource divergence, a written-down independent-failure
    requirement, a genuinely different runtime, a regulatory boundary, or ≥3
    releases in a quarter blocked and recorded at the time.
  - It also names what does **not** qualify, because each has been a real
    argument somewhere: the domain is large (split the module), the deploy is
    risky (make the deploy safer), it would be cleaner (a network boundary is
    not a design tool), we might need to later (the enforced module boundary is
    what preserves that option).
  - Measured against its own criteria, **nothing currently qualifies**. The
    engine and the cell are already separate under criterion 2, and the ADR says
    plainly that this predates it rather than claiming it as a decision made
    under these rules.
  - The five-step extraction procedure puts data separation fourth, because it
    is the irreversible one: a domain that cannot first route all traffic
    through its contracts is not ready to be deployed separately, and finding
    that out at step 2 costs a sprint rather than a quarter.

- [x] **GE-020-005** — Consolidate duplicate person/member/role/approval/audit/finance sources into migration plans.
  - Status: PASS
  - Code/config: [`../migrations/DUPLICATE-SOURCES.md`](../migrations/DUPLICATE-SOURCES.md)
  - Evidence: six areas audited, each with the trigger, ordered steps, what is
    irreversible, and how it is verified. Every count reproduced from the code
    on 2026-08-01 — 11 capability consumers, 2 authorization-engine consumers,
    36 audit writes.
  - **Three of the six turn out not to be duplicates**, and saying so is the
    useful part: `User`/`DirectoryPerson` is a correct separation recorded so a
    later audit does not "fix" it; `RoleAssignment`/`SeatHolding` is a
    current-state table beside a history table; and finance has two callers of
    one domain rather than two sources of truth.
  - **A claim I made and had to withdraw:** §6 first said finance had one
    writer. Checking rather than asserting found a second —
    `approvals/actions.ts:257` posts a `LedgerEntry` when an approval is
    decided. That is correct behaviour, and it surfaced the one real finance
    finding: the double-post guard is a read-then-write rather than a uniqueness
    constraint, so it is correct under the current isolation level and not by
    construction. A unique index on `LedgerEntry.approvalId` is the only change
    the plan proposes there. The withdrawal is left in the document.
  - The item says *do not delete historical data blindly*, and no plan deletes a
    row. Where old data carries weaker guarantees — the 34 unvalidated audit
    rows — the plan is to **say so in the viewer**, not to rewrite them into
    looking stronger.

- [ ] **GE-020-005** — Consolidate duplicate person/member/role/approval/audit/finance sources into migration plans.
  - Status: FAIL — not started. The duplicates are already identified in
    [`../architecture/subsystem-paths.md`](../architecture/subsystem-paths.md)
    §2 and §3; what is missing is the migration plan, and the item is explicit
    that historical data must not be deleted blindly.

## GE-021 / GE-022

- [ ] **GE-021-001 … 007**, **GE-022-001 … 005** — Status: FAIL — not started,
  except where noted below.
  - `apps/web/src/middleware.ts` and `apps/web/src/app/api/me/route.ts` exist in
    the tree and are owned by `configuration` and `identity` respectively in the
    ownership map. They are **not** claimed as passing GE-021-003 or
    GE-022-001: neither has been verified against those items' full scope, and
    counting code that happens to exist as an item completed is exactly what
    rule 3 of this ledger forbids.

- [ ] **GE-GATE-2** — Status: FAIL — 2 of 17 items.
