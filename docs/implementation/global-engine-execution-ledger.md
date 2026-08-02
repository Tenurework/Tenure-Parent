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

## GE-021: Tenant context and command path

- [x] **GE-021-001** — Server-side `TenantResolver` from verified host/domain, session, membership, tenant registry and cell route. Never trust a client header or slug alone.
  - Status: PASS
  - Code/config: `apps/web/src/lib/tenancy/resolver.ts`, `resolver.test.ts`
  - Evidence: resolution gathers every signal, narrows to a candidate, then
    **proves the principal belongs to it**. The proof is the step that matters;
    everything before it is narrowing. A URL saying `/rochester` is a request to
    be treated as Rochester, not evidence of any relationship with it.
  - Decisions worth naming:
    - **Membership is checked per request, not per session.** A membership
      revoked between sign-in and this request must fail, which is why
      `isMember` is a port rather than a claim baked into the token.
    - **Host and path disagreeing is refused, not resolved.** Picking a winner
      would make one of "misconfigured" or "an attempt" succeed.
    - **A tenant hint in a header is refused explicitly** and named in the
      failure, so it appears in logs. `middleware.ts` already strips these at
      the boundary; this is the second line, because "the middleware handles it"
      is a sentence that stops being true during a refactor.
    - **The refusal does not confirm the tenant exists.** Probing slugs learns
      the same thing from a real tenant one cannot reach and one that was never
      there, so the message is not an enumeration oracle.
    - A tenant that is registered but **not serving** — suspended, hibernated,
      offboarding — is refused with that reason rather than a 404 that reads as
      "you typed it wrong".
  - Every lookup is injected, which is what lets the decision be tested against
    combinations that are painful to build in a database: a host bound to one
    tenant while the path claims another, a membership that expired mid-session.
  - Tests: 17, proven to catch by mutation. Eight bypasses, each restored:
    membership no longer proved FAILS, a header hint accepted FAILS, host/path
    disagreement resolved FAILS, anonymous allowed through FAILS, a non-serving
    tenant serving FAILS, the refusal naming the tenant FAILS, platform hosts
    resolvable as tenants FAILS, and reserved segments treated as slugs FAILS.
  - That last one **initially passed when it should not have**, and the reason
    is the useful part: the test only used segments absent from the registry, so
    lookup returned null with or without the guard and the mutation changed
    nothing. It now registers a tenant under the slug `admin` — the case that
    makes the reserved list load-bearing — and fails correctly.

- [x] **GE-021-003** — Strip/reject spoofed internal tenant/actor headers at public boundaries.
  - Status: PASS
  - Code/config: `apps/web/src/middleware.ts`, `apps/web/src/lib/http/internal-headers.ts`,
    `internal-headers.test.ts`
  - Evidence: 35 tests across 18 blocks. The matcher covers **every path with no
    exclusions**, including `/_next/static` and `/favicon.ico` — the conventional
    matcher excludes them and buys a real saving by creating a set of paths where
    the control is off, which is not a property worth having on this control.
  - The policy lives in a separate module from the middleware so it can be
    asserted directly under jest, which cannot instantiate a Next request
    lifecycle, and so a change to the list is reviewed as a change to a list.
  - It landed ahead of GE-021-001 and GE-021-002 on purpose: a deny-list is
    trivial to install while no code reads these headers and expensive once code
    does, and the ordering matters in one direction only — adding the readers
    first ships a window in which the bypass is live.
  - Previously present in the tree and deliberately **not** claimed until
    verified, per rule 3.

- [x] **GE-021-002** — Immutable request context: tenant, cell, actor, session assurance, memberships, assignments, policy/config revision, correlation/trace, locale, resource handles.
  - Status: PASS
  - Code/config: `apps/web/src/lib/tenancy/request-context.ts`, `request-context.test.ts`
  - Evidence: carried through the request on `AsyncLocalStorage`, so it survives
    an await boundary and two concurrent requests stay apart — both asserted,
    because a module-level variable would pass every single-request test and
    lose under load.
  - **Immutability is enforced, not documented.** The context is deep-frozen:
    `Object.freeze` is shallow, so a top-level freeze leaves
    `actor.assurance` and `handles.database` writable — exactly where a
    "helpful" mutation lands, because nobody reassigns the whole context. The
    arrays are copied before freezing, so freezing does not reach back into the
    caller's array and the caller cannot mutate the context afterwards.
  - The failure this prevents is quiet: a middle layer swaps in a fresher config
    revision, the audit row records a decision against a revision the decision
    did not use, nothing detects it, and the incident review reaches the wrong
    conclusion.
  - Refuses to be built wrong: every field that makes a decision explainable is
    required; a tenant the principal does not belong to is rejected even though
    the resolver already proved it, so a context built by another path cannot
    skip the proof; and an object prefix that could address another tenant is
    refused, the same failure the `FileRef` contract catches.
  - `withElevation` returns a **new** context rather than editing one — support
    acting inside a customer tenant is different work, and mutating would leave
    the audit trail unable to say when the elevation began. It requires a reason
    and does **not** raise assurance: acting as support does not make the
    engineer's own sign-in stronger than it was.
  - Tests: 16, proven to catch by mutation. Nine guards removed, each restored:
    shallow freeze FAILS, no freeze FAILS, membership unasserted FAILS, a
    cross-tenant object prefix FAILS, optional required-fields FAILS,
    `requireContext` defaulting FAILS, reasonless elevation FAILS, elevation
    raising assurance FAILS, and arrays stored by reference FAILS.

- [x] **GE-021-004** — Typed command bus with semantic action, resource, expected version, idempotency key, effective time and source.
  - Status: PASS
  - Code/config: `apps/web/src/lib/commands/bus.ts`, `bus.test.ts`
  - Evidence: the `Command` contract already refuses a malformed command; the
    bus is what makes it unavoidable. As long as a handler can be called
    directly the contract is a convention, and the call site that skips it is
    the one written under time pressure.
  - Four things happen here and nowhere else, **in this order**, and the order
    is the design:
    1. **parse** — a value from a browser or a queue was never seen by the
       compiler that believed its type
    2. **claim the idempotency key**, before authorizing or executing. Claiming
       after the work means two concurrent retries both do the work and one
       loses the race to record it — the work having already happened twice.
    3. **authorize now**, not at render time. A page rendered a minute ago; the
       seat may be gone since. Authorization runs *before* the version read, so
       someone who may not act on a resource does not learn whether it exists.
    4. **optimistic concurrency** against `expectedVersion`, with
       `null` meaning create — and a create whose target already exists is
       refused, or two people creating the same thing both succeed and one
       silently overwrites.
  - A handler that throws **releases the key**. A key stuck in-flight makes the
    operation permanently unretryable, which is worse than the original failure.
    The handler's message is never returned — it may name a row, a column or
    another tenant, and that string is rendered to a user.
  - Errors are returned rather than thrown, because a thrown exception at this
    boundary loses the distinction between "your request was wrong" and "we
    failed", and the caller needs it to decide whether to retry.
  - Tests: 17, proven to catch by mutation. Eight bypasses, each restored:
    authorization not rechecked FAILS, version check skipped FAILS, a create
    overwriting FAILS, a reused key replaying FAILS, the key not released on
    failure FAILS, the handler error reaching the caller FAILS, the result
    recorded before the handler runs FAILS, and authorization moved after the
    version read FAILS.

- [x] **GE-021-005** — Tenant-bound repositories requiring a resolved scope; raw unscoped access fails architecture tests.
  - Status: PASS
  - Code/config: `apps/web/src/lib/tenancy/repository.ts`, `repository.test.ts`;
    the raw-client half is `tests/architecture/forbidden-clients.test.mjs`
    (GE-020-002), which already fails any module outside `lib/db.ts`
    constructing a Prisma client.
  - Evidence: `tenancyExtension` already refuses an unscoped query at the Prisma
    layer, and that remains the control that matters. This is the layer above,
    and it exists for a different reason: **the extension refuses at execution**,
    when the query has already been written, reviewed and shipped. A repository
    that cannot be *constructed* without a scope refuses at authoring, which is
    where refusing is cheap.
  - Holding a `BoundRepository` is proof a tenant was resolved — a property a
    function signature can carry, where a comment cannot.
  - It is deliberately **not an abstraction over Prisma**. Wrapping every method
    would be a second query language to learn, kept in sync by hand, worse at
    the thing Prisma is good at. `for()` returns the real delegate; the whole
    contribution is that getting one requires a scope, and that the model is one
    the registry classifies as tenant-scoped.
  - Two refusals with distinct messages: a **platform-global** model asked for
    through a tenant repository (a mistake the extension would allow, since
    those rows genuinely are global), and a model the registry calls scoped that
    the client does not have — **registry/schema drift**, a different problem
    deserving a different message.
  - It throws rather than returning null, on purpose: `repo?.for("X")` would
    yield undefined, and undefined behaves like "no rows" everywhere downstream.
    An unscoped read silently becoming an empty result is worse than an error,
    because it looks like data.
  - Tests: 9, proven to catch by mutation. Six bypasses, each restored: binding
    without a scope FAILS, returning null instead of throwing FAILS,
    platform-global models allowed through FAILS, the refusal no longer naming
    `runUnscoped()` FAILS, drift reported as misclassification FAILS, and
    binding inside an explicitly unscoped block FAILS.

- [x] **GE-021-006** — Transactional audit and outbox with idempotent dispatch, schema versions, retries, DLQ, replay and traceability.
  - Status: PASS
  - Code/config: `apps/web/src/lib/outbox/outbox.ts`, `outbox.test.ts`,
    `prisma/schema.prisma` (`OutboxEvent`), migration
    `20260801210840_outbox_events`
  - Evidence: the property is one sentence — **"the row changed" and "the event
    exists" cannot disagree.** Publishing after commit leaves a window where the
    change happened and the event did not; publishing before leaves the
    opposite. The row is written in the caller's transaction, and delivery
    becomes a separate retryable problem.
  - At-least-once, chosen deliberately: a dispatcher that marks dispatched
    before the consumer confirms can **lose** a record; one that marks after can
    **duplicate** it. Duplication is the survivable failure, because a consumer
    can deduplicate on `eventId` and cannot invent a message it never received.
  - A record whose event no longer satisfies the `DomainEvent` contract is
    dead-lettered **immediately** rather than retried — it will never start
    parsing, and eight attempts would reach the same place with a less useful
    reason.
  - Backoff is exponential, capped at an hour, and **jittered**. Without jitter
    a batch that failed together retries together, turning a transient
    downstream blip into a sustained one at the moment it is least able to
    absorb it. The jitter source is injected so schedules are deterministic in
    tests.
  - `replay` requires **explicit ids** and refuses more than 100. A dead letter
    failed eight times and the reason is usually still true; replaying the queue
    reproduces the incident and buries the one record that would have succeeded.
    Only `dead` records may be replayed — requeuing a pending one duplicates it
    deliberately, the one duplication this design does not accept.
  - Tests: 13, proven to catch by mutation. Nine bypasses, each restored:
    marking dispatched before delivery FAILS, a failure aborting the pass FAILS,
    retrying forever FAILS, retrying an unparseable event FAILS, jitter removed
    FAILS, backoff uncapped FAILS, empty replay FAILS, unbounded replay FAILS,
    and replaying a non-dead record FAILS.
  - **Three existing tripwires fired on the migration, all correctly**, and that
    is the useful part of adding a table here: the registry refused an
    unclassified model carrying `institutionId`; the pinned scoped-model count
    refused to move silently; and the tenant-export suite refused a
    tenant-scoped model with no reader, which would have been a silent empty
    section in a customer's export. Each was fixed with the reasoning recorded
    beside it rather than by adjusting the number.

- [x] **GE-021-007** — Query/job/error envelopes, cursor pagination, conditional operations, rate limits, quotas, async bulk job contracts.
  - Status: PASS
  - Code/config: `apps/web/src/lib/envelopes/pagination.ts`, `limits.ts`,
    `envelopes.test.ts`. The envelope *shapes* are `@tenure/contracts`
    (`Query`, `JobRequest`, `ContractError`) from GE-020-003; this is the
    enforcement over them.
  - Every mechanism here shares a failure mode: **it fails quietly.** A cursor
    that restarts a listing, a page that stops one short, a limiter that says
    "wait 0 seconds", a bulk job reporting success with half its work undone —
    none throws, none logs, and each sends the caller away with a wrong answer
    they cannot detect. So the tests are almost entirely about those.
  - **Cursors are client-supplied values.** One carries the tenant it was
    issued for and the sort it was issued against, and both are checked: a
    cursor from another tenant is a small opaque-looking token that returns
    another tenant's page, and a cursor used against a different ordering names
    a position that is meaningless there and would silently return the wrong
    window. The refusal does not say which tenant it belonged to — that would
    turn it into a way of learning another tenant exists.
  - Deliberately **not signed**. Tamper-evidence is not the property that
    matters, because the tenant is checked against the caller's resolved tenant;
    a signature would add key management for a guarantee already held elsewhere.
  - `hasMore` comes from fetching `limit + 1` rows, not from
    `items.length === limit` — a final page that happens to be exactly full is
    otherwise indistinguishable from one with more behind it.
  - Sort is a **whitelist**: the field arrives from a query string and reaches
    an ORDER BY, and an arbitrary one lets a caller sort by a column they cannot
    read, then infer its values from the ordering.
  - The rate limiter is fixed-window, and says so: a fixed window allows up to
    2× the limit across a boundary. That is acceptable for protecting capacity
    and would not be for gating an attack, and it is written down because the
    next reader will otherwise assume it is sliding. `retryAfterSeconds` rounds
    **up**, since telling a denied caller to wait 0 seconds produces an
    immediate retry that is denied again.
  - A quota denial offers no retry — exceeding it is a plan problem, not a pace
    problem, and waiting will not help. The warning fires only on the request
    that crosses the threshold; reporting it on every subsequent one turns a
    useful warning into noise that gets filtered out.
  - Tests: 32, proven to catch by mutation. Twelve bypasses, each restored, all
    caught.
  - **Two of my own tests were wrong and both were fixed rather than adjusted.**
    A test asserting the negative-count message got the relational one, because
    `processed: -1` satisfies "failed exceeds processed" first — the validator
    now checks negatives first, since every later comparison assumes the counts
    are counts. And the vanished-resource test asserted only status 412, which
    still passes when the null branch is deleted (`null !== "v3"`); it now
    asserts the message, because "that no longer exists" and "this changed since
    you loaded it" lead a user to different actions.

## GE-GATE-2

- [x] **GE-GATE-2** — Status: PASS — every child of Phase 2 is complete.
  GE-020 (5), GE-021 (7) and GE-022 (5) are all checked with evidence:
  ownership and forbidden-client boundaries, runtime-gate contracts, tenancy
  resolution and request context, the command bus, bound repositories, the
  outbox, envelopes and limits, the tenant/seat shell with its switching proof,
  the ten dense-ERP states, WCAG 2.2 AA measured in a browser, localization
  with RTL and a business calendar, and flags / experiments / exposure /
  compatibility / kill switches.
  - 17 of 17. Each item's evidence, mutation proof and honest limits are
    recorded above; nothing here is checked on a declaration alone.

## GE-022: Common UX/runtime

- [x] **GE-022-001** — Tenant/seat-aware shell, `/me` bootstrap, tenant/seat switcher, navigation from semantic entitlements, clear active context.
  - Status: PASS
  - Code/config: `app/api/me/route.ts`, `components/shell/TenantSwitcher.tsx`,
    `components/shell/ShellHeader.tsx`, `(app)/actions.ts` (`switchTenantAction`),
    `lib/authz/navigation-capabilities.ts`, `lib/tenant-scope.ts`
  - **All five parts already existed.** What did not exist was any proof of the
    load-bearing claim, which `(app)/actions.ts` states in a comment:
    > every later request re-proves the membership rather than trusting the
    > cookie — that, not the switch action, is what stands between a forged
    > cookie and another tenant's rows.
    A comment asserting a security property is worth exactly what the test under
    it is worth, and there was none. `lib/tenant-switching.itest.ts` is that
    test: 8 cases against real Postgres, because the property is "the membership
    row decides" and a mock decides whatever it is told.
  - The case that matters revokes a membership **between two identical calls**.
    That is the only way to tell a re-derived answer from a cached one: a cached
    answer keeps working, a re-derived one stops. It also asserts the switcher
    stops offering the tenant, so the UI cannot keep showing one the server
    would now refuse.
  - Proven by mutation: trusting a requested tenant without checking membership
    FAILS, granting a scope to a user with no memberships FAILS, and memoising
    the candidate set across calls FAILS.
  - That third mutation initially **passed**, and the reason is worth keeping:
    the marker string appears twice in `tenant-scope.ts` and the mutation landed
    in the wrong function. Re-anchored on `resolveTenantScope`, it fails
    correctly. A mutation that does not reach the code under test proves nothing
    about it, and it looks identical to a guard that works.
  - Honest limit: the **cookie-reading** path (`actingInstitutionChoice`) needs a
    Next request context and is not covered here. It is exercised by the browser
    e2e suite; this file covers the decision it delegates to.
  - Three guards fired on the new file and all three were right — the raw-client
    rule, the ownership map, and the exemption-size ratchet. Each was resolved
    with its reason recorded rather than by adjusting a number.

- [x] **GE-022-002** — Design tokens/components for dense ERP states: loading,
  empty, error, permission denied, stale, conflict, offline, archived, partial,
  high-risk confirmation.
  - Status: PASS
  - Code: `components/ui/states.ts` (the semantics table + copy + `retryAdvice`),
    `components/ui/StateSurface.tsx` (one component, rendering from the table)
  - Tests: `components/ui/states.test.ts` — 18 cases, all green
  - **Not a palette.** The item lists ten states, and the thing that goes wrong
    is not their colour. It is that each panel re-decides three questions and
    gets one of them wrong:
    - which ARIA role, and how urgently a screen reader is interrupted
    - whether what is on screen may be read as a **complete** answer
    - whether a retry is offered, and whether retrying could possibly help
  - The middle one is why this exists. `stale`, `partial`, `offline` and
    `permission-denied` all render something, and a reader who cannot tell them
    from a complete result decides on an incomplete one. `presentsAsComplete` is
    true for exactly **two** states — `empty` and `archived` — because those are
    the only two where what is on screen IS the whole correct answer. Empty *is*
    the answer; archived is correct but no longer live. The other eight are not,
    and the component renders a **textual** marker for them, not a tone. Colour
    alone fails for a reader who cannot distinguish it, and "this is not
    everything" is the one thing they must not miss.
  - Two pieces of copy are load-bearing:
    - `permission-denied` never names what it hides. "You cannot see the
      Rochester budget" confirms a Rochester budget exists — the same
      enumeration oracle the tenancy resolver (GE-021-001) and the command bus
      (GE-021-004) already refuse to leak. A UI that leaks it back undoes that
      work, so a test greps the string.
    - `conflict` says **reload**, not retry, because retrying the identical
      write reproduces the conflict. `retryable: false` and the copy agree, and
      `retryAdvice()` carries the *reason* a retry is absent so it cannot be
      re-added by someone who only sees a missing button.
  - `role` and `aria-live` come from the table and are **not props**. A prop
    would let one call site announce a loading spinner assertively over whatever
    the reader was doing. A test asserts the component has no such prop.
  - Proven by mutation — 9 of 9 caught, then restored and green again:
    `stale` marked complete FAILS; `loading` set to `assertive` FAILS;
    `permission-denied` made retryable FAILS; the denial copy naming a budget
    FAILS; `conflict` copy saying "try again" FAILS; deleting the incomplete
    marker FAILS; hardcoding the ARIA role FAILS; dropping a tone from the token
    map FAILS; a literal hex in place of a token FAILS.
  - One mutation initially reported **SKIP — marker not found**, because the
    component had been rewritten onto the design tokens after the mutation was
    written. Recorded rather than quietly dropped: a mutation whose anchor has
    drifted proves nothing and is indistinguishable from a guard that works.
  - Design tokens: `TONE` maps four tones onto `globals.css` variables. Four
    rather than ten because the palette is a smaller vocabulary than the state
    set — `stale`, `offline`, `partial` and `permission-denied` are different
    situations that should look the same amount of unfinished. A test asserts
    every tone the table can produce has an entry (a missing one is
    `undefined.frame` — a blank panel in production) and that the file contains
    no hex/rgb literal, since a literal survives the dark-mode switch and the
    high-contrast media query unchanged.
  - Honest limit: `@testing-library/react` is not installed and
    `apps/web/jest.config.js` runs in `node`, so the component's *rendered DOM*
    is asserted by reading its source, not by mounting it. That catches the
    decisions (role from the table, marker present, retry gated) but not layout.
    Layout is covered by the headless geometric suite. Recorded rather than
    papered over: adding a DOM test dependency for this one item is a larger
    change than the item.

- [x] **GE-022-003** — Responsive PWA and WCAG 2.2 AA engineering targets for
  keyboard, focus, semantics, reflow, contrast, status/error announcements,
  reduced motion, captions, and screen readers.
  - Status: PASS
  - Code: `lib/a11y/contrast.ts`, `lib/a11y/theme-tokens.ts`,
    `components/shell/SkipLink.tsx`, `components/shell/NavDrawerToggle.tsx`,
    plus the token and component fixes listed below
  - Tests: `lib/a11y/contrast.test.ts` (16 cases, all four themes) and
    `e2e/a11y.spec.ts` (9 criteria, headless Chromium). Full e2e suite
    **148/148** on a freshly recreated database.
  - Two halves, because the criteria split cleanly into what arithmetic can
    prove and what only a browser can see. Contrast is computed; everything
    else is measured in a real page.

  **Contrast, computed.** sRGB relative luminance and the ratio per WCAG 1.4.3
  for every pairing the product renders, in light, dark, and each under
  `prefers-contrast: more`. Token values are **read from `globals.css`**, not
  copied: a hand-maintained palette copy passes forever while the stylesheet
  drifts, and gets more convincing as it gets less true. Six real failures,
  all fixed — see the commit for the numbers. Alpha compositing is load-bearing
  rather than decorative: every dark-theme badge background is `rgba()`, and a
  ratio taken against the raw rgb claims a legible surface that does not exist.

  **The browser half.** Nine criteria, each named for the criterion rather than
  filed under "accessibility test", because only a criterion can pass or fail.
  Every one of these was **observed red first**, with the failure it reported —
  which is a stronger proof than a synthetic mutation, since the defect was
  real rather than introduced:
    - **2.4.1 Bypass Blocks** — there was no skip link at all. Thirty-odd Tab
      stops between arriving on a page and reaching its content, on every
      navigation. `SkipLink` is now the first Tab stop; the test also presses
      Enter and asserts `document.activeElement.id === "main"`, because without
      `tabIndex={-1}` on the target the fragment scrolls and focus stays put —
      the next Tab walks back into the nav the user just skipped.
    - **1.4.10 Reflow** — every one of the five pages scrolled sideways at
      320px. Root cause: the 224px side nav had **no narrow-screen behaviour**,
      leaving 96px for the page. Below 700px it is now an off-canvas drawer
      (`NavDrawerToggle`, Escape closes it, widening past the breakpoint
      dismisses it). Then four content overflows fell out one at a time — a
      `<select>` sized by its longest club name, a comment input that would not
      shrink, a 192px date label, and a pill that would not wrap. All four were
      `min-width: auto` on a flex item.
    - **2.5.8 Target Size** — 6×6px carousel dots and a 20px-tall search input.
      The dots keep their 6px of ink inside a 24×24 button: the target has to
      be 24px, not the ink.
    - **2.4.11 Focus Not Obscured** — new in 2.2 and the one this shell was most
      exposed to. Tabbing below the fold scrolled the control into the
      *viewport*, whose bottom 38px is the fixed footer. Fixed with
      `scroll-margin` at zero specificity via `:where()`.
    - **2.4.7 Focus Visible** — `LineAreaChart` and `DonutChart` set
      `outline: none` inline and put nothing back, so every datum was a Tab stop
      you could not see. Both now carry `.chart-hit`.
    - **1.3.1 / 4.1.2** — two unlabelled inputs on `/feed` carrying only a
      placeholder, which disappears on typing and is not reliably announced.
    - **2.1.2, 1.4.4, 2.3.3** passed on first run and are kept as regressions.
  - Three exclusions are stated in the spec rather than left to look covered:
    the skip link is 1×1 until focused (measuring it hidden fails the one
    control that exists to help); SVG chart geometry takes 2.5.8's *Essential*
    exception, since a bar's width is the data — with the keyboard path and the
    per-datum label as the reason that is acceptable rather than ignored; and
    the reflow probe skips fixed subtrees, after two rounds of it pointing at a
    closed drawer parked off-canvas instead of the element actually overflowing.
  - Contrast proven by mutation, 9 of 9 caught. One initially survived —
    reducing the theme parser's balanced-brace scan to a first-brace scan
    changed nothing, because `globals.css` has no nested rules today. The claim
    that it would "return a partial palette" lived in a comment and nowhere
    else. Replaced with a fixture that does nest.
  - Honest limits: **captions and audio description (1.2.x) are NOT_APPLICABLE**
    — the product ships no time-based media, and this becomes a real gap the
    first time a video is embedded. The focus checks walk the **Tab order**,
    which is the keyboard path, not every route to focus. 3.x Understandable is
    a judgement about copy, not a property a browser can assert. And the SVG
    focus ring is verified by computed style, not by pixels.
  - PWA: `manifest.ts` already declared name, `start_url`, `display:
    standalone` and icons; its `theme_color` moved with the primary token.
    Installability was already met, so the work here was the responsive and
    assistive-technology half of the item.

- [x] **GE-022-004** — Localization infrastructure for BCP 47 language, IANA
  time zone, locale formats, currencies, fiscal/business calendars, RTL, and
  tenant terminology.
  - Status: PASS
  - Already existed and is cited rather than re-claimed: **BCP 47 language**
    (`localization.ts`, validated by asking `Intl` rather than by a regex that
    would be wrong about some real tag), **currency** (ISO 4217, with
    `money.ts` reading each currency's minor-unit exponent — JPY has none, KWD
    has three, and a hardcoded divide-by-100 is a hundredfold error either
    way), **fiscal year start**, **first day of week**, **IANA time zone**
    (`Institution.timeZone` + `institution-time.ts`), and **tenant
    terminology** (`definitions.ts`).
  - New here: **RTL**, the **business calendar**, and the wiring that makes any
    of it reach a page.
  - Code: `packages/platform-config/src/direction.ts`,
    `packages/platform-config/src/business-calendar.ts`,
    `apps/web/src/lib/tenancy/locale-cookie.ts`, plus `blueprints/index.ts`
  - Tests: `direction.test.ts`, `business-calendar.test.ts`, updated
    `localization.test.ts` and `approvals-sla.test.ts`, and
    `e2e/localization.spec.ts`. Full e2e **152/152** on a recreated database.

  **RTL.** There was no `dir` anywhere in the product and `<html lang="en">`
  was a literal, so every tenant declared English to every screen reader
  regardless of configuration — a WCAG 3.1.1 failure no amount of correct
  configuration would have fixed. Direction is now **derived, never
  configured**: there is deliberately no `platform.localization.direction` key,
  because a setting that let an administrator disagree with the writing system
  would only ever be used to get it wrong. It is computed from the script, not
  the language — `az-Arab` is right-to-left and `az-Latn` is not, and any list
  of "RTL languages" gets that pair wrong whichever way it is written.
  - The shell's frame moved to logical properties (`start-0`, `border-e`,
    `padding-inline-start`) so a right-to-left reader does not get a
    left-to-right layout with the words turned round. `transform` has no
    logical form, so the off-canvas drawer needs an explicit `[dir="rtl"]`
    rule — without it the nav slides across the page instead of off it.

  **Business calendar.** `approvals-sla.ts` carried a comment saying
  calendar-day counting was "a documented follow-on". It was also a live
  defect: a request submitted Friday afternoon was two days old on Sunday and
  flagged for attention on Monday morning, before anyone could have looked at
  it. The SLA was measuring the weekend. `workingDays` is a **list** rather
  than a "weekend starts here" index because Friday–Saturday is not a rotation
  of Monday–Friday, and `holidays` are plain `YYYY-MM-DD` dates rather than
  instants, because a closure is a date and storing an instant lands it on the
  wrong day for half the users.

  **The wiring, which is where the first attempt was wrong.** The document's
  language is resolved in the root layout, because `<html>` cannot be set from
  a nested layout and correcting it after paint would flash the whole page the
  wrong way round. The first version read a slug cookie written on tenant
  switch — and the e2e caught that this leaves every user who has never
  switched, i.e. most of them, rendering `lang="en"` forever. It now falls back
  to one indexed database lookup, with the cookie as a cache. Reading a cookie
  at all is safe for one reason: it decides **nothing** — a forged value
  changes date formatting and text direction and cannot reach a row, which
  `tenant-switching.itest.ts` covers from the other side.

  **A fixture that can fail.** Both real bindings are English, Monday-to-Friday
  and left-to-right, so every localization claim the engine makes was true by
  accident. `blueprints/index.ts` gains `fixture-rtl` — the same device as the
  existing `midtown-arts` fixture and labelled as one — written right-to-left,
  working Sunday to Thursday, closing on dates neither other tenant observes.
  The e2e drives a real page to it and asserts `lang`, `dir`, the *computed*
  direction, and that the nav has moved to the other side.

  - Proven by mutation, 9 of 9 caught. **Two initially survived**, and the
    reason is the useful part: this runtime has
    `Intl.Locale.prototype.getTextInfo()`, so the script-table fallback never
    ran and no test touched it — replacing the table with a list of "RTL
    languages" and deleting the `maximize()` call both left the suite green.
    The fallback exists precisely for runtimes *without* the standard API,
    which is exactly where a silent wrong answer goes unnoticed. It is now
    exported and tested directly rather than through the function that shadows
    it.
  - Honest limits: the shell is direction-aware, **page-level content is not
    audited for physical properties** — a full logical-property sweep of every
    page is a larger change than this item and is not claimed. The RTL fixture
    is a registry binding with no database row, so the e2e reaches it through
    the presentation cookie rather than a real tenant switch. And no shipped
    tenant is right-to-left today; what is proven is that the engine would
    render one correctly.

- [x] **GE-022-005** — Safe feature flags/experiments, cohort rollout, config
  compatibility, telemetry, and emergency restrict-only kill switches.
  - Status: PASS
  - Already existed and is cited rather than re-claimed: **flags under a
    restrict-only law** (`flags.ts` — a flag may only ever narrow; a flag that
    could turn something *on* would be a second authorization system nobody
    audits, and `assertRestrictOnly` makes a violating declaration a startup
    failure), **cohort rollout** (FNV-1a bucketing, stable forever, salted per
    flag so two flags at 10% do not hit the same tenth of people), and
    **emergency kill switches** (`unionSet`, the one strategy that makes a kill
    un-revokable from a lower-privileged layer). All three are consumed by real
    routes, not just declared.
  - New here: **experiments**, **exposure telemetry**, and **config
    compatibility**.
  - Code: `packages/platform-config/src/{experiments,exposure,compatibility}.ts`,
    the cell-side check in `lib/provisioning/reconcile.ts`, and `configKeys` on
    the manifest in `packages/provisioning/src/execute.ts`
  - Tests: `experiments.test.ts`, `exposure.test.ts`, `compatibility.test.ts`
    (28 cases) plus three new cases in `reconcile.itest.ts` against Postgres

  **Experiments inherit the restrict-only law by having no opinion about
  access.** An experiment chooses between presentations of something the subject
  may *already* do; it is gated by a flag, and when that flag is off the
  assignment is `null`. So there is no path where being in an experiment lets
  someone do something they otherwise could not — asserted by driving the real
  kill switch through the real registry, not a hand-made `{enabled: false}`.
  - Variant assignment uses a **different salt** from rollout. Without it, a
    flag at 50% admits buckets 0–49 and those are exactly the subjects that fall
    in the first variant: one arm gets everyone, the other gets nobody, and the
    experiment reports a clean null result. The test measures the correlation
    rather than trusting the comment.
  - Weights must sum to 100 at *definition*. Weights summing to 90 leave a tenth
    of subjects unassigned, and missing traffic looks exactly like control.

  **Exposure telemetry counts, and holds no identity.** `(flag, reason)` and
  `(experiment, variant)`, incremented at the single decision point in
  `lib/config/server.ts` so a new consumer cannot forget to. It deliberately
  does **not** key by subject or tenant: the question is "did this arm get
  traffic", not "who was in it", and an exposure log keyed by person is a
  behavioural record of every user built as a side effect of shipping a feature
  — and the sort of thing that ends up in a public workflow log, which this
  repository has already had happen once. Honest limit, stated in the module and
  not papered over: the counters are **per process** and are lost on restart.

  **Config compatibility closes a gap `schemaVersion` does not cover.** The
  existing pin compares the *database* schema; it says nothing about the
  configuration registry. So an engine that gains a key and a cell that has not
  been rebuilt agree on the schema and still disagree about what the
  configuration means — and ignoring the unknown key is the silent failure: the
  Studio shows the setting as published and the cell quietly does something
  else. The manifest now declares `configKeys`, and a cell refuses any it does
  not implement. Absent is treated as "the engine did not say", not "it sets
  nothing", so every manifest published before this still applies.
  - Honest note on `checkCompatibility`'s version arm: with the schema pinned to
    *exact* equality, a per-key minimum version can never fail independently, so
    that arm is redundant today. It is implemented and tested because it becomes
    load-bearing the moment the pin is relaxed to a range, and because
    `parseVersion` throwing rather than defaulting to `0.0.0` is what stops the
    whole guard being silently inert — a version that parses to zero compares
    older than everything and every check passes.
  - The engine-side change surfaced a stub that was lying: the cross-check test
    composed `values: { a: 1 }`, so the manifest declared a key no engine would
    ever set. The fix was to make the stub realistic, not to widen the check.

  - **CI caught a defect this ledger should record, because it is the kind that
    passes locally forever.** `direction.ts` (GE-022-004) preferred
    `Intl.Locale.prototype.getTextInfo()`. The engine's containers run **Node
    20**, which has only the older `textInfo` getter — and that getter reports
    the *language's* default direction rather than the tag's, calling `dv-MV`
    (Thaana) and `az-Arab` left-to-right. Node 22 gets both right. The standard
    API is not one answer in two spellings; it is two answers, and the same
    tenant would lay out one way on a container and the other way on the next.
    Direction is now derived from the script on every runtime, verified by
    running the logic under `node:20-alpine` — 28 tags, all agreeing. The
    module's own comment had *claimed* runtime-independence while deferring to
    the runtime.


---

# Phase 3 — Tenure Parent control plane and configuration engine

## GE-030: Global registries

- [x] **GE-030-001** — Global tenant registry with immutable ID, lifecycle,
  legal/customer metadata, plan, region/residency, isolation, cell placement,
  release, config revision, and safe login projection.
  - Status: PASS
  - Code: `packages/provisioning/src/tenant-registry.ts`,
    `apps/system-studio/src/lib/registry-record.ts`, wired into
    `registerTenant` and the Studio's `TenantRecord`
  - Tests: `tenant-registry.test.ts` — 15 cases
  - **A manifest is what somebody asked for; this is what is true.** They were
    one structure before, and a single structure serving both is how an
    operator comes to edit a field that describes reality. The record carries
    what the system writes — placement, release, applied config revision,
    lifecycle — and the manifest keeps carrying intent.
  - **The id is not the slug.** A slug is a URL and customers ask to change
    URLs. `tenantId` is generated once and never reused, and every other record
    points at it, so a rename is a field update rather than a rewrite of every
    reference — which is how an audit trail ends up pointing at a tenant that
    no longer exists under that name.
  - **Residency is a constraint, checked.** `placement.region` is where the
    tenant runs; `residency` is where it is *allowed* to run. A migration can
    satisfy capacity and breach a contract at the same time, and that is
    precisely what one field cannot express. An empty residency list is refused
    rather than read as "anywhere" — "anywhere" is never what a customer with a
    residency requirement agreed to, and an empty list is the easiest way to
    get there by accident.
  - **The login projection is four fields, asserted rather than described.**
    The sign-in page is reachable by anyone, so whatever it can read is
    effectively public — and "which universities use Tenure, in which regions,
    on which plan" is a customer list. A test names the exact field set and a
    second one greps the serialized projection for the legal name, contact,
    plan, tenant id, release and entitlements. It returns `null` for anything
    not serving, because the difference between "wrong password" and "your
    institution is suspended" is a fact about that institution's commercial
    relationship, told to whoever typed the URL.
  - The lifecycle graph is declared once rather than checked ad hoc: `ARCHIVED`
    is terminal (restoring a tenant is a new registration against a restored
    backup — a different operation with a different approval), nothing reaches
    it without passing through `DEPROVISIONING`, and `SUSPENDED` cannot escape
    through `MIGRATING`, which would resume service for a tenant somebody
    deliberately stopped.
  - Proven by mutation, 10 of 10 caught: residency unchecked, an empty list
    read as "anywhere", validation stopping at the first problem, the plan
    added to the projection, a suspended tenant resolving, archived becoming
    reversible, archiving without deprovisioning, migrating out of a
    suspension, a suspended tenant counted as serving, and the slug pattern
    dropped.
  - The type-checker caught a real modelling error while wiring it: the record
    declared `isolation: "pooled" | "dedicated"`, a narrower vocabulary than
    the manifest's four-value `IsolationTier`. Two spellings of "how isolated"
    is how a record and the manifest that produced it come to disagree about
    the same tenant. Fixed by using the existing type, not by widening a cast.
  - Honest limits: placement is `cell-<region>` — one cell per region, and the
    single line that changes when there are several is marked. There is no
    migration path yet for the tenants registered before this record existed;
    `registry` is optional on `TenantRecord` for exactly that reason, and a
    console that 500ed on them would be a console nobody could use to fix them.
    Lifecycle transitions are *validated* here but the registry still advances
    through the existing `TenantState` machine — unifying the two is GE-030-002
    work, not a claim made here.

- [x] **GE-030-002** — Cell registry with partition/account/region/environment,
  capacity, services, versions, health, routing, residency, backup/DR, and
  migration metadata.
  - Status: PASS
  - Code: `packages/provisioning/src/cell-registry.ts`,
    `apps/system-studio/src/lib/cells.ts`; placement wired into `composeTenant`
  - Tests: `cell-registry.test.ts` — 17 cases
  - **Health is not a boolean.** A cell mid-upgrade is serving traffic and must
    not receive a new tenant. A draining cell is serving traffic and must not
    receive one either, for a completely different reason. Collapsing those into
    `healthy: false` loses the reason, and the reason is what tells an operator
    whether to wait or to act. Five states; exactly one is placeable.
  - **Placement filters in a fixed order and reports where it narrowed to
    nothing.** Residency is a contract, health is a fact, capacity is a
    preference — and reporting "no capacity" when the real problem is that no
    cell may legally hold the tenant sends an operator to add hardware that
    cannot help. The decision carries counts through each filter for exactly
    that reason.
  - Ties break on the emptiest cell, then on cell id. Deterministic, because a
    placement that depends on map iteration order cannot be reproduced when
    someone asks why a tenant went where it did — the test runs the same fleet
    in two orders.
  - A cell whose residency zones exclude its own region is refused: it would be
    holding its own data somewhere it is not permitted to. An empty zone list is
    refused too — "no tenant may be placed here" is a real state, and it is
    `DRAINING` said explicitly rather than an empty array said by accident.
  - Registration previously derived the cell id as `cell-<region>` from the
    manifest. That is correct exactly while there is one cell per region and
    silently wrong the day there are two, in the direction of registering a
    tenant against a cell that is full, draining, or in another environment. It
    is now a decision, and a refusal comes back as a form problem naming which
    of the three filters rejected it.
  - Proven by mutation, 10 of 10 caught. Two initially did not, and both were
    the mutation's fault rather than the test's: one was a no-op
    (`.reverse().sort()` with the same comparator sorts identically) and one had
    an escaping error that made its marker match nothing. A mutation that does
    not reach the code proves nothing about it and looks exactly like a guard
    that works.
  - Honest limits: the fleet is **one cell**, read from the environment. That is
    a fact about the estate — the AWS inventory found a single ECS service in
    one account and one region — and inventing a second so the code "looks
    scalable" would mean placing a tenant somewhere that does not exist. The
    record's `capacity.tenants` is supplied by configuration rather than counted
    from the tenant registry, so it can drift; wiring that count is GE-033-002's
    fleet-health work. `migration` is recorded and validated but nothing writes
    it yet — there is no migration path to write it.

- [x] **GE-030-003** — Identity-connection registry, verified domains,
  pool/app-client mapping, certificates/secrets references, health, rotation,
  and expiry.
  - Status: PASS
  - Code: `packages/provisioning/src/identity-registry.ts`,
    `apps/web/src/lib/auth-connections.ts`; provider selection in
    `apps/web/src/lib/auth.ts` now runs through it
  - Tests: `identity-registry.test.ts` (43 cases), `auth-connections.test.ts`
    (12 cases). Full e2e **152/152**, Studio layout suite **28/28**.

  **The invariant everything else serves** is the bible's §9.1: a work email is
  a *discovery hint*, and the resolver "never reveals whether a person exists or
  grants membership from an email domain". Owning `rochester.edu` and having an
  account at Rochester are different facts, and a system that conflates them
  lets anyone with an address at a verified domain in. So
  `discoverTenantByDomain` returns a tenant id and nothing else — there is no
  shape in the return type that could carry a person.

  **Domain matching is on label boundaries, not string suffixes.** A naive
  `endsWith` makes `evil-rochester.edu` match `rochester.edu`, handing whoever
  registers that name a route to Rochester's own sign-in page — branded, and
  looking exactly right. Three variants of that attack are tested, plus the
  reverse (verifying `simon.rochester.edu` proves nothing about
  `rochester.edu`).

  **An ambiguous domain is refused, not resolved.** Two tenants verified for one
  domain is a state the registry must not have, and silently picking the first
  would let whichever was written first hijack the other's sign-in — an attack
  nobody has to attack anything to perform. `findDomainConflicts` exists because
  the conflict is invisible in any single record: each one validates clean
  alone, and the problem only exists in the set.

  **Credentials are references, and that is checked.** A `ref` must look like a
  Secrets Manager ARN or an SSM parameter path, which refuses a pasted
  certificate before it is stored — in a registry that is read by the console,
  projected into login discovery, and serialised into artifacts.

  **The sign-in projection carries two fields.** `kind` and `displayName`, with
  the field list asserted and a second test grepping for the issuer, pool id,
  app client id, credential ref, tenant id and connection id. An issuer names
  the customer's own IdP; an app client id is half of what an attacker needs to
  craft an authorization request that looks like ours.

  **Health checks status before expiry**, because a revoked connection with a
  fresh certificate is still revoked, and putting "revoked" and "fine" in the
  same bucket on a fleet health page is how the one that matters gets missed. An
  unparseable expiry is treated as **expired**: failing closed on a login method
  is an inconvenience, failing open is an outage discovered by users.
  `EXPIRING_SOON` is still offered — it works today, and removing it early takes
  a working tenant offline to prevent a future problem.

  **Made live rather than declared.** `auth.ts` selected the Okta provider with
  an inline `!!OKTA_ISSUER && startsWith("https://")` — three of the registry's
  checks and none of the others. It now goes through `oktaIsUsable`, so a
  missing client id, a secret pasted as a value rather than referenced, and an
  expired credential are all refused. Each of those previously produced a
  provider NextAuth registers happily and that fails at the callback: visibly to
  a user, invisibly to anyone watching. Tests name that explicitly.

  - Proven by mutation, **22 of 22 caught** across both modules (16 + 6). One
    initially survived: "report the LAST credential rather than the soonest" got
    the right answer because the fixture happened to list the soonest last. The
    test now runs both orders — a "take the last one" implementation is correct
    whenever the list happens to be sorted, which is most of the time.
  - The type-checker pushed a real improvement: the environment parameter was
    `NodeJS.ProcessEnv`, which demands `NODE_ENV` and so forced every test to
    supply it to describe a connection. Narrowed to what the module actually
    reads, which also stops the surface growing unnoticed.

  - **BLOCKED_EXTERNAL for the Cognito half.** The registry models pool and
    app-client mapping and validates it, but the estate has no Cognito — the
    GE-GATE-0 AWS inventory found no user pool, and inventing one so the code
    "looks wired" would be a record pointing at nothing. No tenant SAML/OIDC
    connection exists to register either; the only real connections are this
    cell's own, which is what is wired. To unblock, an operator runs:
    ```
    aws cognito-idp create-user-pool --pool-name tenure-platform \
      --region us-east-1 --profile <engine-account>
    aws cognito-idp create-user-pool-client --user-pool-id <id> \
      --client-name tenure-web --generate-secret
    gh secret set COGNITO_POOL_ID --repo satvikOS/Tenure-Parent
    gh secret set COGNITO_APP_CLIENT_ID --repo satvikOS/Tenure-Parent
    ```
    Domain verification has the same shape: `dns-txt` is modelled and validated,
    and nothing publishes or polls a TXT record because no tenant has claimed a
    domain. Both are the *registry* being complete ahead of the estate, recorded
    as such rather than claimed as integrated.
  - **CI caught the test fixture, and the guard that caught it was itself
    wrong.** `tests/security/no-personal-data.test.mjs` flagged a plausible
    address at a real domain in the new test — correctly. But it scanned
    `git ls-files`, tracked files only, so it was blind to the file until
    `git add`: it passed locally and failed only after the address was already
    in a pushed commit. For a check whose entire purpose is stopping data
    reaching a public repository, that is the wrong order — it was a report,
    not a control. It now scans untracked-but-not-ignored files too, which is
    the same fix `tools/platform-truth.mjs` already carries for the same
    reason. Proven by writing an unstaged file containing an address and
    watching the suite go 58/59, then removing it and watching it return to
    59/59. The fixture itself no longer contains an example address at all:
    `discoverTenantByDomain` is passed a domain, and the point of the test is
    that the local part never reaches it.
  - Honest limit: SCIM tokens are modelled as a credential purpose with expiry
    and rotation, but no SCIM endpoint exists — that is GE-04x work.

- [x] **GE-030-004** — Entitlements, plan, quota, usage meter, feature catalog,
  and tenant commercial-billing metadata.
  - Status: PASS
  - Code: `packages/provisioning/src/commercial.ts`,
    `packages/provisioning/src/plan-catalog.ts`; the Studio's compose form and
    `composeTenant` now derive entitlements from a contracted plan
  - Tests: `commercial.test.ts` — 31 cases. Studio e2e **39/39**.
  - Entitlements already existed as bare strings that `module-runtime` checks.
    What did not exist is where a tenant's strings come from. "Which modules may
    this tenant run" was answerable; "why, and until when" was not.

  **Two rules shape the whole module.**
  - *A quota check fails closed.* An unknown dimension, a missing plan, or a
    limit with no meter is `UNKNOWN` and refuses. Treating any of those as
    "under the limit" is how an unmetered dimension becomes unlimited in
    production while looking enforced in code — and it is the natural mistake,
    because pretending usage is zero reads as reasonable.
  - *A downgrade refuses new work and never destroys old work.* A tenant that
    drops to a plan allowing 10 organizations while holding 25 is `OVER_LIMIT`.
    The right answer is to refuse the 26th, not to delete 15, and the enum says
    so — `AT_LIMIT` and `OVER_LIMIT` are different answers and only one of them
    is about the record you are trying to create.
  - `AT_LIMIT` refuses the next one: the limit is the count you may hold, so
    holding it means the next is one too many. Off by one here is either a free
    extra or a customer who cannot reach the number they bought.
  - A `soft` limit never refuses. That is what makes it soft, and a soft limit
    that occasionally blocks is worse than a hard one because nobody expects it.

  **A lapsed contract entitles nothing.** `entitlementsFor` returns `[]` outside
  the activation window, and an unparseable window is not an active one.
  Returning the plan's list regardless would keep every paid feature working for
  a customer who has stopped paying, with the software behaving perfectly and
  nothing surfacing it.

  **A commercial override may GRANT** — unlike a feature flag, which under
  GE-022-005's law may only restrict, because a signed amendment grants things
  and modelling it as a restriction would make it inexpressible. It requires a
  reason and an approver for exactly that asymmetry: a grant nobody can explain
  is a grant nobody can bill for or withdraw, and it outlives whoever added it.
  It also rides on the contract, so it does not survive the window lapsing.

  **The tenant-facing projection hides the commercial relationship.** Plan name,
  entitlements and usage; no price, no contract dates, no override reason and no
  approver. Those are negotiated by different people than the ones administering
  the system, and an override reason is often a note about a customer written
  for internal readers. Asserted by grepping the serialized projection.

  **`monthlyPriceCents` is `number | null`, and both catalog entries are
  `null`.** No price has been agreed for either tier, and `0` is a commercial
  statement — it says Tenure gives this away. A catalog asserting that about a
  plan nobody has priced is wrong in the direction of a refund claim.

  **Made live.** The compose form asked an operator to type a comma-separated
  entitlement list, which made every tenant's commercial state a typing
  exercise: a typo was a silently missing feature and nothing reconciled against
  an invoice. It is now a plan select, entitlements follow from the plan, and an
  unknown plan is reported as a form problem rather than silently entitling
  nothing. The `plan` on the registry record is the plan that was contracted,
  not one inferred back out of the entitlements it produced — which would have
  named the wrong plan the moment two plans shared an entitlement.
  - The catalog has **two** tiers because two is what the tenant bindings
    already demonstrate: `rochester` holds `finance`, `midtown-arts` is refused
    it. A third invented tier would put a price on something nobody has agreed
    to sell.

  - Proven by mutation, **16 of 16 caught**: missing plan permitting creation,
    unset read as unlimited, no meter assumed zero, the limit off by one, at-
    limit permitting, soft refusing, a lapsed contract still entitling, the
    window ignoring its start and its end, an unparseable window read as active,
    overrides without a reason, a dimension limited twice, the report omitting
    forgotten dimensions, and the projection leaking the price or the override
    reasons.

  - **The Studio's e2e suite was never run by anything.** Thirty-nine tests —
    the operator gate, the layout geometry, the platform console — existed and
    no workflow executed them, so `platform.spec.ts` had been looking for a link
    named "Organization systems" (the page's `<h1>`) when the nav entry is
    "Systems", and had been red indefinitely without saying so. A suite nobody
    runs is documentation with a test-runner API. Fixed the locator and added a
    `Studio · Playwright` job to `ci.yml` that builds the Studio, waits for it
    to answer, and runs the suite — with no AWS credentials, because the
    registry degrades when `DYNAMODB_TABLE` is unset and pointing CI at a real
    tenant table would mean reading customer configuration to check a heading.
  - A build-hygiene note worth keeping: three layout tests failed mid-tick and
    the cause was mine, not the code's — a `git stash` experiment rebuilt the
    baseline into `.next` underneath a running server, leaving the process
    serving a mix of two builds. Clean rebuild, restart, 39/39. Never rebuild
    under a running server.
  - The Studio build refused `PLAN_CATALOG` imported into `ComposeForm.tsx`:
    `@tenure/provisioning`'s index reaches `node:crypto` for the manifest
    digests, and a client component importing it fails the build. That is the
    build telling the truth about what would otherwise be shipped to a browser.
    The plan list is now read server-side in `page.tsx` and passed as a prop,
    which is how the form already receives blueprints and modules.

  - Honest limits: **nothing meters anything yet.** `UsageMeter` is the shape a
    reading takes and `checkQuota` refuses when there is no reading, which is
    the correct behaviour for today's state, but no collector writes one — that
    is GE-033-002's fleet-observability work. No `Contract` is persisted either;
    the registry record carries `plan` and the contract type is exercised by
    tests. Both are the commercial *model* being complete ahead of the
    commercial *process*, recorded as such.

- [ ] **GE-030-005** — Status: FAIL — not started.
