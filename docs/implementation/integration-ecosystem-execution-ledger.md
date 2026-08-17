# Global Integration Ecosystem and Connector Certification — execution ledger

Every `INT-*` requirement stated by `Tenure_Global_Integration_Ecosystem_and_Connector_Certification_Claude_Bible_v1.0.md`.

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

- [x] **INT-000-001** — Inventory current internal events, APIs, queues, jobs, webhooks, files, credentials references, provider SDKs and connector claims.
  - Status: PASS
  - Code: `tools/int-integration-inventory.mjs` derives the inventory from the working
    tree and writes `docs/architecture/int-integration-inventory.md`. Nine sections, one
    per noun the requirement names: HTTP surfaces (every `route.ts` in `apps/web` and
    `apps/system-studio`, with the verbs it exports and a direction derived from the
    path), internal events, SQS queues, scheduled rules, alarms, S3 buckets and
    file-exchange modules, credential references, provider SDKs, connector claims.
    Deterministic on purpose: files come from `git ls-files --cached --others`
    (POSIX paths, stable order) rather than `readdirSync`, every list is sorted on an
    explicit string key, every file is CRLF-normalised before matching, and the document
    is joined with `\n` under the repository's `* text=auto eol=lf`. The on-disk output
    contains zero CR bytes.
  - What it says now, every number re-derived by hand against the tree before this row
    was written: 28 route handlers (1 inbound from a provider —
    `apps/web/src/app/api/payments/provider-events/route.ts`; 3 inbound from the
    scheduler under `/api/jobs/`), 2 internal event types, 5 SQS queues
    (`infrastructure/terraform/sqs.tf` declares `default_dlq`, `email_dlq`, `default`,
    `email`, `notifications` — counted independently with
    `grep -rn '^resource "aws_sqs_queue"' infrastructure/`), 0 of them with a producer
    in the tree, 1 scheduled rule, 4 CloudWatch alarms
    (`infrastructure/terraform/cloudwatch.tf`: `ecs_running_tasks`, `alb_5xx`, `rds_cpu`,
    `dlq_messages`), 2 S3 buckets (`infrastructure/terraform/s3.tf`: `documents`,
    `exports`), 3 file-exchange modules, 25 credential references by NAME only, 44
    provider SDK dependencies out of 88 direct dependencies scanned, and 24 connector
    claims — `grep -c '^  pack({$' packages/provisioning/src/provider-packs.ts` returns
    24.
  - Defect found and fixed while verifying: the generated document opened
    `**INT-000-001** — inventory of current internal events…`, which
    `tools/document-graph.mjs` reads as this document STATING the requirement. Because
    the file trips the graph's authority markers by discussing the Bible, and
    `classify()` sorts with `localeCompare` (which puts `docs/architecture/…` ahead of
    `Tenure_…`), the generated ANSWER had taken ownership of INT-000-001 and INT-000-002
    away from the Bible: `node tools/loop/next-batch.mjs` printed
    "inventory of current internal events, APIs, queues, jobs," — a truncated line of
    this document's own prose — as the requirement, with phase
    `docs/architecture/int-integration-inventory.md`. The header now cites the ids
    inline, ownership is back with the Bible, and the queue prints the Bible's sentence.
  - Tests: `tests/architecture/int-integration-inventory.test.mjs`, 15 tests, run with
    bare `node --test` at the repository root (this is `npm run test:platform`'s runner —
    no TypeScript, no jest globals). 15/15 green. It re-runs the generator with `--check`
    and compares bytes, opens every path the document cites, floors every section against
    a structure a reader can count independently, re-derives the queue-producer verdict,
    the connector count and the route count from the tree with code that shares nothing
    with the generator, refuses token-shaped literals, and — added here — refuses any
    line of the generated document that opens `ID — text`. The detectors are themselves
    proven against assembled fixtures, so none of them can pass by matching nothing.
  - Mutations, 2 applied, 2 caught, both restored, 15/15 green again after each:
    (1) deleted the real `| email_dlq | …` queue row from
    `docs/architecture/int-integration-inventory.md` — tests 1 and 6 failed (13 pass /
    2 fail); regenerated, 15/15.
    (2) in the generator, `if (/\bSendMessage(?:Batch)?Command\b/.test(text))
    senders.push(file)` → `if (/\bsendMessage\(/.test(text)) senders.push(file)` and
    regenerated, which made the document say "0 of 5 SQS queues are orphans" — a wrong
    but perfectly self-consistent inventory that `--check` blesses. Test 7, the
    independent re-derivation, failed (14/1); restored, 15/15. That mutation is the one
    that matters: it proves the guard catches a document that is current and false, not
    only one that is stale.

- [ ] **INT-000-002** — Map producer/consumer and actual traffic for every integration resource; identify orphan/producerless queues and false green alarms.
  - Status: BLOCKED_EXTERNAL
  - Three clauses. Two are done and guarded; the third cannot be done from this
    repository, and the row is blocked rather than passed because a mapping that
    silently drops "actual traffic" is exactly the false-complete this programme keeps
    producing.
  - Done — producer/consumer, in `docs/architecture/int-integration-inventory.md`
    §2–§5, generated by `tools/int-integration-inventory.mjs`: every internal event with
    its declared emitters, declared consumers, the files that actually call
    `outboxEventRow` and the file that actually registers a consumer, read three
    independent ways and kept apart; every SQS queue with a per-queue verdict; every
    scheduled rule with its target; every alarm with its namespace, metric and
    `treat_missing_data`.
  - Done — orphans and false green alarms, §10: **5 of 5 SQS queues are orphans**
    (nothing in `apps/**`, `packages/**` or `modules/**` constructs an
    `SendMessageCommand` or a `ReceiveMessageCommand`; the only holder of
    `@aws-sdk/client-sqs` is System Studio's read-only observability path), and
    **1 of 4 alarms cannot fire** — `dlq_messages`, `infrastructure/terraform/cloudwatch.tf:56`,
    namespace `AWS/SQS`, metric `ApproximateNumberOfMessagesVisible`,
    `treat_missing_data = "notBreaching"` over `aws_sqs_queue.default_dlq`, which nothing
    enqueues to. It is green because nothing has ever arrived, not because delivery is
    healthy. One further finding: `ApprovalRequested` is produced by
    `apps/web/src/app/(app)/approvals/actions.ts` and registered by no consumer in
    `apps/web/src/lib/outbox/consumers.ts`.
  - Blocked — actual traffic. Every statement above is a proof about the repository.
    "Nothing in the tree enqueues" is not "no messages flowed", and writing the two as
    one sentence is the failure the inventory's own preamble refuses. Measuring traffic
    needs read-only credentials for the AWS account that owns the estate, which this
    workspace does not have and must not acquire on its own. The exact commands, once a
    human grants a read-only role and names the account and region:
    `aws cloudwatch get-metric-statistics --namespace AWS/SQS --metric-name NumberOfMessagesSent --dimensions Name=QueueName,Value=<project>-<environment>-default --start-time <T-30d> --end-time <now> --period 86400 --statistics Sum`,
    repeated for `-default-dlq`, `-email`, `-email-dlq` and `-notifications` (the five
    names `infrastructure/terraform/sqs.tf` builds from `local.name_prefix`, defined at
    `infrastructure/terraform/main.tf:70` as `"${var.project}-${var.environment}"`), plus
    `aws cloudwatch describe-alarm-history --alarm-name <project>-<environment>-dlq-messages`
    for the alarm's real transition history and
    `aws logs filter-log-events --log-group-name <group> --filter-pattern '"/api/jobs/"'`
    for the scheduler-invoked routes. `<project>`, `<environment>`, the account and the
    region are deliberately left as placeholders: this row invents no account id, no ARN
    and no region.
  - Not done here, and named so it is not mistaken for done: no traffic figure appears
    in the inventory, and `tests/architecture/int-integration-inventory.test.mjs` asserts
    the document keeps saying "Actual traffic is not measured" rather than letting the
    gap close itself by omission.
  - Reason: the remaining clause requires authenticated read-only AWS access that no
    command available in this repository can grant.

- [x] **INT-000-003** — Import every `INT-*` requirement into the canonical ledger.
  - Status: PASS
  - What is true: this ledger carries 65 `INT-*` rows —
    `grep -c '^- \[[ x]\] \*\*INT-' docs/implementation/integration-ecosystem-execution-ledger.md`
    returns 65 — and `requirementsIn()` in `tools/document-graph.mjs`, the parser the work
    queue itself uses, reads exactly 65 `INT-*` ids out of
    `Tenure_Global_Integration_Ecosystem_and_Connector_Certification_Claude_Bible_v1.0.md`,
    54 numbered and 11 `INT-GATE-*`. Every one is in the queue at
    `node tools/loop/next-batch.mjs`, which is the production caller: it reads status
    from this file through `ledgerStatuses()`.
  - Tests: `tests/architecture/int-requirements-are-imported.test.mjs`, 6 tests, bare
    `node --test` at the repository root, 6/6 green. It compares the two sets in BOTH
    directions (nothing stated without a row, nothing rowed that the Bible does not
    state), pins the count at 65 so a Bible edit and a ledger edit cannot delete the same
    ten and agree with each other, refuses a repeated id (two rows are two statuses and
    the loop reads whichever the parser saw last), refuses an `INT-*` row filed in another
    domain's ledger — `importedIds()` is a union, so a misfiled row reads as imported
    while the owning domain has nothing to work — and asserts every INT row in the
    generated registry resolves back to the Bible at its canonical path.
  - Defect found and fixed: that last assertion was RED.
    `docs/architecture/int-integration-inventory.md`, the generated answer to INT-000-001
    and INT-000-002, opened with `**INT-000-001** — …`, which `tools/document-graph.mjs`
    reads as that document STATING the requirement; it trips the graph's authority
    markers by discussing the Bible, and `classify()` sorts with `localeCompare`, which
    puts `docs/architecture/…` ahead of `Tenure_…`. So the answer owned the requirement
    and the Bible did not. Fixed in `tools/int-integration-inventory.mjs` by citing the
    ids inline instead of restating them; the document was regenerated, not hand-edited.
  - Mutations, 2 applied, 2 caught, both restored, green again after each:
    (1) deleted the `- [ ] **INT-050-003**` row from this ledger — test 2, "every INT
    requirement the Bible states has a row in the integration ledger", failed (5 pass /
    1 fail); restored, 6/6.
    (2) re-applied the pre-fix header to the generator and regenerated — test 5, "the
    generated registry owns exactly the INT requirements the Bible states", failed, and
    the repository-wide `tests/architecture/document-graph.test.mjs` "a requirement stated
    twice is stated identically" additionally listed `INT-000-001` and `INT-000-002`
    alongside the pre-existing `WRK-000-001`; restored, and only `WRK-000-001` remains
    (another domain's document, same shape, not touched here).

- [x] **INT-000-004** — Establish domain ownership and prohibit direct connector table writes.
  - Status: PASS
  - Code: `tools/int-connector-write-boundary.mjs` — `plane()`, `providerIngress()`,
    `authenticatesProvider()`, `writesIn()`, `writeHandles()`, `schemaModels()`,
    `PLANE_OWNED_MODELS`, `collect()`, `violations()`, `render()`. It computes the integration
    plane, the models that plane owns, every Prisma write in or out of it, and writes
    `docs/architecture/int-connector-write-boundary.md`; `--check` fails when the tree and the
    document disagree.
  - Two clauses, both answered from the tree rather than asserted.
    **Ownership** is DERIVED, not declared here: `tools/ownership-map.mjs` already assigns every
    source file to exactly one of fourteen platform domains and
    `tests/architecture/ownership.test.mjs` fails on an orphan, so this reads that map and its
    first rule is that every plane module has exactly one owning domain. A second ownership table
    would have been a second authority on one question, which is what having two parsers already
    cost this repository. The plane is two derivations and no favourites: the 22 production
    modules the map assigns to `integrations`, plus every HTTP entry point that AUTHENTICATES A
    PROVIDER — detected by the thing such a route cannot skip, reading a provider signature header
    off the request. That second derivation is why
    `apps/web/src/app/api/payments/provider-events/route.ts` is in the plane: the map puts it
    under `billing-metering`, correctly, and a plane defined only as "the integrations domain"
    would have excluded the one route a provider can actually POST to.
    **The prohibition** is the Bible's §2 invariant — "No connector can directly write private
    domain tables or post ledger rows. It invokes authorized typed commands" — enforced in three
    rules: a plane module may write only a plane-owned model (`ProviderEventReceipt`,
    `ConnectionLaunchToken`, each with its reason next to it); a module that writes a plane-owned
    model must BE in the plane, because a fence that only stops the owner writing outward has a
    gate on the other side; and no raw SQL from inside the plane, since `$executeRaw` carries no
    model name to classify. The other 50 models in `apps/web/prisma/schema.prisma` — the ledger,
    the approval graph, the audit trail — are reachable only through the typed command bus.
  - What it says now, every number re-derived by hand before this row was written: 23 plane
    modules over 2 owning domains (22 `integrations`, 1 `billing-metering`), 52 models in the
    schema, 2 of them plane-owned, 3 writes from inside the plane
    (`provider-events/route.ts:153` → `ProviderEventReceipt.create`,
    `connections/pending-intent.ts:203` → `ConnectionLaunchToken.create`, `:273` →
    `ConnectionLaunchToken.updateMany`), 3 writes to a plane-owned model anywhere in the tree —
    the same three — and 0 violations.
  - Caller: `tests/architecture/int-connector-write-boundary.test.mjs` imports it and runs it
    with `--check`; `tools/run-platform-tests.mjs` discovers that file, `npm run test:platform`
    runs the discovery, and `.github/workflows/ci.yml:88` runs `npm run test:platform`. Same
    arrangement as `tools/int-integration-inventory.mjs`, whose row is two entries above this
    one. It is deliberately NOT in `npm run generate`: a matrix or a boundary that silently
    refreshes itself when a connector changes is a boundary nobody had to look at, and the
    `--check` failure prints the exact command to run.
  - Defects found and fixed while building it, both by mutation:
    (1) the write scan read string literals, and this repository's permission vocabulary is
    dotted — `"finance.budget.update"` has `budget` as a real model property and `update` as a
    real mutator, so `apps/web/src/app/(app)/orgs/[slug]/finance/actions.ts` was reported as
    writing the Budget model on a line that only NAMES a permission. Four bogus write handles
    (`communications`, `events`, `finance`, `resources`) came from the same cause. `blankStrings()`
    now blanks quoted contents with spaces, preserving line numbers; the handle set fell to
    `db, tx`.
    (2) the test's independent re-derivation used `git grep` without `--untracked`, so it greps
    the index only. The mutation below adds a NEW connector file — exactly the case this boundary
    exists to catch on the commit that adds it — and the re-derivation could not see it, then
    accused the generator of inventing a write. `--untracked` added.
  - Tests: `tests/architecture/int-connector-write-boundary.test.mjs`, 15 tests, bare
    `node --test` at the repository root (the platform runner's runner — no TypeScript loader,
    which is why every source is read as text). 15/15 green. It re-derives the plane, the writes
    and the ingress through `git grep` and `classify()` with code that shares nothing with the
    generator; asserts the forbidden set really contains `LedgerEntry`, `AuditEvent`,
    `Transaction`, `Settlement` and `ApprovalRequest` so "no violation" is a statement about real
    tables; proves each of the four rules fires, on fixtures rather than by editing a connector;
    proves the detector reads code and not prose or permission strings; asserts no handle carries
    a model write past the scanner; asserts the typed-command door
    (`apps/web/src/lib/commands/bus.ts`, `export async function dispatch`) exists, because a
    prohibition pointing at a door that does not exist is a dead end; and refuses any line of the
    generated document that opens `ID — text`, which is the trap that took INT-000-001 and
    INT-000-002 away from the Bible once already.
  - Evidence — mutations, 3 applied, 3 caught, all restored, 15/15 green after each:
    (1) **a connector posts a ledger row.** Added `apps/web/src/lib/connections/mutation-probe.ts`
    containing `await db.ledgerEntry.create({ data: { memo: "MUTATION-8811" } as never })` — a new
    file under a prefix the ownership map gives to `integrations`, so it is in the plane by
    derivation. Regenerated, ran: `not ok 14 - the boundary is clean right now`, verbatim
    `+ ['outbound: apps/web/src/lib/connections/mutation-probe.ts:3 writes LedgerEntry.create,
    which the integration plane does not own']` against `- []`. Deleted, regenerated, 15/15.
    (2) **something outside the plane writes a plane-owned table.** Added
    `apps/web/src/lib/finance-probe-9042.ts` containing
    `await db.providerEventReceipt.create({ data: { eventId: "evt-9042" } as never })` — a prefix
    the map gives to `erp-modules`. `not ok 14`, verbatim
    `+ ['inbound: apps/web/src/lib/finance-probe-9042.ts:3 writes ProviderEventReceipt.create from
    outside the integration plane']`. Deleted, restored, 15/15.
    (3) **the generator goes current-but-false.** Changed `providerIngress` to test
    `calls(read(f))` instead of `code(read(f))` — one token — so the string-blanking pass erases
    the header it is looking for and the ingress set becomes empty. Regenerated, so `--check`
    passes against a document that agrees with a broken generator: `not ok 3` (the independent
    re-derivation, diffing out `apps/web/src/app/api/payments/provider-events/route.ts`),
    `not ok 11` (the ingress detector, against its fixture) and `not ok 14` (the route's own
    receipt write is now inbound-from-outside). Restored, 15/15. That is the mutation that
    matters: it proves the suite catches a boundary document that is current and false, not only
    one that is stale.
  - Not done here, named so it is not mistaken for done: this is a STATIC proof about the code.
    Nothing has connected to Postgres, so a database grant that let a connector write a domain
    table anyway is invisible to it; and there is no `OperationalOwnership` record per connector
    (Bible §4's object list), which needs a schema this wave may not change. The row closes the
    two clauses the requirement states, not §4's object inventory.

- [ ] **INT-010-001** — Implement canonical objects, envelope, schemas, correlation, causation and lineage.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Integration_Ecosystem_and_Connector_Certification_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **INT-010-002** — Implement tenant-aware outbox/inbox, delivery and idempotency.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Integration_Ecosystem_and_Connector_Certification_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **INT-010-003** — Implement large-payload governed references, scanning, checksum and expiry.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Integration_Ecosystem_and_Connector_Certification_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **INT-010-004** — Implement async jobs, checkpoints, backpressure, retries, circuit breaking and DLQ worklists.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Integration_Ecosystem_and_Connector_Certification_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **INT-010-005** — Prove service restart, duplicate and partial failure preserve one business effect.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Integration_Ecosystem_and_Connector_Certification_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **INT-020-001** — Implement signed/versioned connector package and constrained SDK.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Integration_Ecosystem_and_Connector_Certification_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **INT-020-002** — Implement capability-first registry, lifecycle, exact availability and known limitations.
  - Status: FAIL
  - Four clauses. Three exist and one does not, and the row is FAIL rather than passed because a
    registry that cannot state a capability's limitations is the registry that produces the "up,
    but its delta sync is broken" claim nobody wrote down.
  - Exists, and read by `tools/int-connector-capability-matrix.mjs`:
    **capability-first** — `packages/provisioning/src/connector-capability.ts` carries status on a
    `ConnectorCapability` (provider / product / capability / direction), not on a whole pack, which
    is the distinction its own header argues for: "a Microsoft pack is not one fact".
    **lifecycle** — seven states (`PLANNED`, `DEVELOPMENT`, `CERTIFICATION_PENDING`, `AVAILABLE`,
    `DEGRADED`, `SUSPENDED`, `UNSUPPORTED`) plus the entry's `CatalogLifecycle`.
    **exact availability** — `capabilityProblems` refuses `AVAILABLE`/`DEGRADED` with no evidence
    and refuses a status that disagrees with the artifact gate, and evidence is a `Record` keyed on
    all 8 `CERTIFICATION_CLAUSES` with a direction per ref, so a write pack citing only read runs
    is refused.
  - Missing: **known limitations**. The only limitation field is `restrictions.disclaimer`, one
    free-text string per catalog ENTRY, and for all 24 provider packs it is the same generated
    sentence ("Planned. No connector code, app registration, scope set, certification or provider
    review exists for …"). Nothing per CAPABILITY, nothing structured, and nothing that forces a
    `DEGRADED` capability — the state whose whole meaning is "runs with a known limitation" — to
    say what the limitation is. `grep -rn "limitation" packages/provisioning/src` returns one hit,
    in `execute.ts`, about a MAC signature.
  - What would close it, without a schema change: a required `limitations: readonly
    {scope, effect, workaround, since}[]` on `ConnectorCapability`, empty only for `PLANNED` and
    `UNSUPPORTED`, refused as empty by `capabilityProblems` for `DEGRADED` and `SUSPENDED`; and the
    matrix's "clauses cited" column joined by a limitations column. That is an edit to
    `packages/provisioning`, which the ownership map gives to `control-plane` — a different
    domain's package, so it is not taken here.
  - Evidence: `docs/architecture/int-connector-capability-matrix.md` §2 shows the three clauses
    that work (24 rows, each with lifecycle, per-capability status and `0 of 8` clauses cited) and
    §6 shows the fourth clause's absence as 24 identical generated blockers rather than 24 stated
    limitations. Re-derivable with `node tools/int-connector-capability-matrix.mjs --check`.

- [ ] **INT-020-003** — Enforce egress, secret, event, tenant and resource constraints.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Integration_Ecosystem_and_Connector_Certification_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **INT-020-004** — Implement provider/API compatibility, deprecation and security suspension.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Integration_Ecosystem_and_Connector_Certification_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **INT-020-005** — Prove an unauthorized connector cannot access other tenants/secrets/domains.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Integration_Ecosystem_and_Connector_Certification_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **INT-030-001** — Implement supported OAuth/OIDC/service/mTLS/key/file authentication profiles.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Integration_Ecosystem_and_Connector_Certification_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **INT-030-002** — Implement secure callback/state/PKCE/account verification and least scopes.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Integration_Ecosystem_and_Connector_Certification_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **INT-030-003** — Implement credential broker/references, rotation, expiry, revoke and reauth worklists.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Integration_Ecosystem_and_Connector_Certification_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **INT-030-004** — Ensure secrets never appear in configuration, events, logs or evidence.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Integration_Ecosystem_and_Connector_Certification_Claude_Bible_v1.0.md`; not yet implemented
  - Incremental evidence 2026-08-11: `slack.workspace` now declares only
    GitHub Actions secret **names** (`SLACK_APP_ID`, `SLACK_CLIENT_ID`,
    `SLACK_CLIENT_SECRET`, `SLACK_SIGNING_SECRET`) in its setup schema. System
    Studio renders those reference names and the source store, while
    `packages/provisioning/src/catalogs.test.ts` and
    `apps/system-studio/e2e/platform.spec.ts` assert the surface does not
    contain Slack token-shaped values. This is not a connector certification:
    Slack capability status remains `PLANNED`.

- [ ] **INT-030-005** — Pass wrong-account, wrong-tenant, over-scope and revoked-consent negative tests.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Integration_Ecosystem_and_Connector_Certification_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **INT-040-001** — Implement schema registry/version compatibility and provider change detection.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Integration_Ecosystem_and_Connector_Certification_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **INT-040-002** — Implement signed deterministic mapping/transformation packages and lineage.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Integration_Ecosystem_and_Connector_Certification_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **INT-040-003** — Implement reference resolution, quarantine, split/aggregate and large-volume checkpoints.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Integration_Ecosystem_and_Connector_Certification_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **INT-040-004** — Implement mapping migration, comparison, rollback and golden tests.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Integration_Ecosystem_and_Connector_Certification_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **INT-040-005** — Prove hostile transforms cannot access network/files/secrets/other tenants.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Integration_Ecosystem_and_Connector_Certification_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **INT-050-001** — Implement signed/replay-safe webhook ingress and subscription lifecycle.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Integration_Ecosystem_and_Connector_Certification_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **INT-050-002** — Implement polling/watermarks with gap/overlap/clock-skew handling.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Integration_Ecosystem_and_Connector_Certification_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **INT-050-003** — Implement SFTP/HTTPS file exchange, manifest/control totals, encryption and retention.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Integration_Ecosystem_and_Connector_Certification_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **INT-050-004** — Implement API/event/stream patterns with versioned limits.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Integration_Ecosystem_and_Connector_Certification_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **INT-050-005** — Implement EDI/AS2 partner/channel envelope and acknowledgements where in scope.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Integration_Ecosystem_and_Connector_Certification_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **INT-060-001** — Implement provider limit profiles, fairness, priority and adaptive backpressure.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Integration_Ecosystem_and_Connector_Certification_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **INT-060-002** — Implement stable error taxonomy and exception worklists.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Integration_Ecosystem_and_Connector_Certification_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **INT-060-003** — Implement safe replay with preview, authorization, idempotency and audit.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Integration_Ecosystem_and_Connector_Certification_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **INT-060-004** — Implement reconciliation policies and zero unexplained critical variance.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Integration_Ecosystem_and_Connector_Certification_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **INT-060-005** — Prove unknown outcomes do not cause blind duplicate business actions.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Integration_Ecosystem_and_Connector_Certification_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **INT-070-001** — Implement all thirteen Integration Studio surfaces.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Integration_Ecosystem_and_Connector_Certification_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **INT-070-002** — Generate connection setup from connector/configuration schemas.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Integration_Ecosystem_and_Connector_Certification_Claude_Bible_v1.0.md`; not yet implemented
  - Incremental evidence 2026-08-11: `ConnectorEntry.setup` can now carry a
    rendered setup schema for credential references, and the System Studio
    catalog section renders that schema from `availabilityDecisions` rather
    than from a hand-written Slack row. The first concrete row is Slack's
    GitHub-secret-name contract. Remaining work: full schema generation for all
    connector setup fields, save/resume, preview, approval, canary and rollback.

- [ ] **INT-070-003** — Implement save/resume, diff, preview, approval, canary and rollback UX.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Integration_Ecosystem_and_Connector_Certification_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **INT-070-004** — Pass WCAG 2.2 AA, themes, localization, density, keyboard and visual regression.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Integration_Ecosystem_and_Connector_Certification_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **INT-070-005** — Prevent credential values/payload secrets from appearing in Studio.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Integration_Ecosystem_and_Connector_Certification_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **INT-080-001** — Create registry entries for all capability families in Section 7 without false availability.
  - Status: FAIL
  - The second clause holds and the first does not, and the two must not be reported as one.
  - **No false availability** — proven. `docs/architecture/int-connector-capability-matrix.md` §5
    lists all **67** capability families §7 names, every one as `no`, and §1 reports 0 of 24
    connector capabilities and 0 of 31 payment capabilities supported. `node --test
    tests/architecture/int-connector-capability-matrix.test.mjs` asserts the family count equals the
    bullets in §7 of the Bible (67 today, re-derived by slicing the section and counting `^- `) and
    that no family may read as supported while the certified set is empty.
  - **Registry entries — absent.** All 67 families are enumerated in a generated REPORT, which is
    not a registry: nothing in `packages/provisioning` has a row for "MDM/UEM device compliance and
    actions" or "eDiscovery/legal hold and records export", so a Studio catalog cannot list a
    capability nobody has asked for a provider for, and the Bible's §16.1 requirement to show
    "capabilities first, eligible providers second" has no capability list to show first. The 24
    packs cover a handful of §7's families incidentally, and the matrix deliberately refuses to
    guess which — a fuzzy match between a family's name and a pack's key is how a claim nobody
    checked gets published.
  - The blocker is a type, not a decision. `ConnectorEntry` is provider-keyed: an entry requires
    `provider`, `product` and `egressHosts`, and a capability family has none of those — it is the
    ABSTRACT thing a provider might fulfil. So a family row needs a new entry kind
    (`kind: "capability-family"`, carrying the §7 subsection, the family's own sentence, the
    eligible-provider list and no availability at all) in
    `packages/provisioning/src/catalogs.ts` — a package the ownership map gives to
    `control-plane`. Not taken here: twelve agents editing one catalog in parallel is how a schema
    nobody can reason about gets built, and this is the second domain's file.
  - Evidence: `node tools/int-connector-capability-matrix.mjs --check` regenerates and verifies the
    67-family table; `grep -c '^  pack({$' packages/provisioning/src/provider-packs.ts` returns 24,
    which is the size of the set that DOES have registry entries.

- [ ] **INT-080-002** — Bind pack integration requirements to eligible certified connector capabilities.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Integration_Ecosystem_and_Connector_Certification_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **INT-080-003** — Import the complete Payments Bible for Stripe; prevent generic-toggle bypass.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Integration_Ecosystem_and_Connector_Certification_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **INT-080-004** — Enforce Bedrock-only customer AI inference boundary.
  - Status: FAIL
  - Not unbuilt — **violated**, by the running code, and this row exists to stop that being read as
    a gap in a plan. `packages/platform-config/src/model-policy.ts` declares a two-entry
    `MODEL_CATALOG` and both entries are `provider: "anthropic"` at `lifecycle: "PUBLISHED"`;
    `apps/web/src/lib/ai.ts` calls `api.anthropic.com` with the key borrowed from
    `apps/web/src/lib/connections/credential-broker.ts`. The catalog's own comment states the
    difference plainly — "`regions` is `["*"]` for the Anthropic API because it is a global endpoint
    rather than a regional one. That is a real difference from Bedrock" — so nothing here is
    hidden; it is simply the opposite of what this requirement asks for, and §26 lists "route
    customer records to external AI APIs" among the prohibited shortcuts.
  - Evidence: `docs/architecture/int-connector-capability-matrix.md` §4 renders both entries with
    "Where inference happens" derived from the provider (`third-party API (anthropic)`), and §6
    carries one blocker per non-Bedrock model. `tests/architecture/int-connector-capability-matrix.test.mjs`
    asserts the derivation both ways: a fixture entry at `provider: "bedrock"` must read as
    `in-account (Bedrock)`, and the real catalog must contain no such entry — so the day a Bedrock
    model lands, that assertion fails and points at this row. 13/13 green with the violation
    recorded, which is the honest state.
  - What the boundary would require, none of which is a line of code this wave can write: a Bedrock
    model id and region approved for the partition, an IAM path for the task role to invoke it, a
    decision on what happens to the two Anthropic entries (revoked, or kept for non-customer
    content with an enforced projection rule), and an ADR — because moving where customer content is
    inferred is an authority decision, not a refactor. The enforcement half is then cheap and
    belongs beside `modelIsAllowed`: refuse any catalog entry whose provider is not `bedrock` when
    the payload carries customer content, and a guard test over the catalog. The blocker is the
    decision and the AWS access, not the check.
  - Reason: requires a Bedrock model approval, an IAM grant and an ADR that do not exist; the
    platform's only two published models call a third-party API today.

- [ ] **INT-080-005** — Enforce exact payroll, bank, healthcare, public-sector and regulated capability scopes.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Integration_Ecosystem_and_Connector_Certification_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **INT-090-001** — Implement connector certification scope, evidence, expiry and re-certification triggers.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Integration_Ecosystem_and_Connector_Certification_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **INT-090-002** — Bind connector code/config/schema/mapping/tests/runbooks into immutable releases.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Integration_Ecosystem_and_Connector_Certification_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **INT-090-003** — Implement waves, canaries, tenant compatibility, hold, rollback and emergency suspension.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Integration_Ecosystem_and_Connector_Certification_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **INT-090-004** — Monitor official provider/API/security changes and affected tenants.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Integration_Ecosystem_and_Connector_Certification_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **INT-090-005** — Prove all thirteen E2E scenarios.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Integration_Ecosystem_and_Connector_Certification_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **INT-100-001** — Implement suspend, hibernate, reactivate, offboard and purge semantics.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Integration_Ecosystem_and_Connector_Certification_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **INT-100-002** — Verify token/webhook/provider/AWS residuals and costs after lifecycle operations.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Integration_Ecosystem_and_Connector_Certification_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **INT-100-003** — Pass tenant isolation across metadata, payloads, queues, caches, files, search, logs and support.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Integration_Ecosystem_and_Connector_Certification_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **INT-100-004** — Pass threat model, restore, DR, performance, volume and provider-outage tests.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Integration_Ecosystem_and_Connector_Certification_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **INT-100-005** — Produce final supported connector/capability matrix and every blocker/limitation.
  - Status: FAIL
  - Overturned on review: Fails check 5: the ledger row's stated verdict is false. It records the 31 Stripe leaves as '(26 PLANNED, 5 UNSUPPORTED)', and packages/payments/src/capability-registry.ts contains 24 `planned(` and 7 `unsupported(` — the seven being acceptance.in-person-terminal, cards.lifecycle, cards.physical-and-virtual, financial-account.embedded, financial-account.transfers, funds-flow.application-fee, identity.kyc-kyb (confirmed three ways: grep -cE on the constructors, collect().payments filtered by state, and 7 occurrences of '| UNSUPPORTED | no |' in the committed matrix). The row asserts 'every number re-derived independently before this row was written', and the mutation-2 note is self-contradictory: it says it dropped 'the five UNSUPPORTED leaves' while pasting the real failure `24 !== 31`, i.e. seven. In a requirement whose whole subject is a document that must never be one row past the truth, a hand-written statistic that was not re-derived is exactly the defect this check exists for. Everything else verified and reproduces: the requirement sentence (Bible line 745) matches the claim; 13/13 green; all three mutations re-run one at a time and restored — status hardcoded to 'PLANNED' produced a BYTE-IDENTICAL document that passed --check and was still caught by `not ok 7` with `+ 'PLANNED'` vs `- 'AVAILABLE'`, narrowing the payments constructor pattern gave `not ok 3` with verbatim `24 !== 31`, deleting the `asana.work` row gave `not ok 1`; counts re-derived by me independently (24 packs via `grep -c '^ pack({$'`, 31 payment leaves, 2 models, 67 §7 families, 57 blockers = 24+31+2); reached via run-platform-tests discovery and ci.yml:88; no status is authored in the tool, both real models are correctly reported as third-party-API inference rather than in-account, and the 0-supported verdict is a derived zero (no pack carries AVAILABLE/DEGRADED), not an unknown reported as zero. Fix is two digits in docs/implementation/integration-ecosystem-execution-ledger.md; no code or test change is needed.
  - Code: `tools/int-connector-capability-matrix.mjs` — `connectorPacks()`/`parsePacks()`,
    `paymentCapabilities()`/`parsePayments()`, `modelCatalog()`/`parseModels()`,
    `capabilityFamilies()`, `certificationClauses()`, `statesRequiringApproval()`, `collect()`,
    `render()`, `SUPPORTED_CONNECTOR_STATUSES`. It joins the four registries that declare
    integration status and writes `docs/architecture/int-connector-capability-matrix.md`;
    `--check` fails when the document and those registries disagree.
  - A hand-written matrix is the most dangerous document this programme can produce: it is the
    page somebody reads before telling an institution what Tenure integrates with, and every
    incentive pushes it one row past the truth. So no status is written in it. The sources are
    `packages/provisioning/src/provider-packs.ts` (24 connector packs, each with a lifecycle, a
    capability, a direction and per-clause certification evidence),
    `packages/payments/src/capability-registry.ts` (31 Stripe capability leaves, counted
    SEPARATELY because §26 forbids reducing Stripe to a generic connector),
    `packages/platform-config/src/model-policy.ts` (the model catalog, the only integration here
    with a `PUBLISHED` lifecycle) and §7 of the Bible itself (67 capability families, listed as
    unsupported rather than omitted, because an omitted capability reads as one nobody asked for).
  - What the matrix says, every number re-derived independently before this row was written:
    **0 of 24 connector capabilities supported** (every pack `PLANNED`, every one citing nothing
    for all 8 certification clauses — `golden, negative, volume, failure-outage,
    throttling-and-deprecation, deletion-propagation, acl-change-propagation, scope-exactness`),
    **0 of 31 payment capabilities transactable** (26 `PLANNED`, 5 `UNSUPPORTED`, none naming an
    approval ADR on disk), **2 of 2 models published**, **67 capability families named and none
    supported**, **57 blockers**, one per unavailable thing and nothing unavailable without one.
    What a tenant can actually use today is therefore exactly two Anthropic models — and §6 of the
    document records that as the matrix's largest limitation, not as a capability.
  - Why "no certified capability exists" is rigorous rather than evasive: the matrix does NOT
    guess which §7 family a pack fulfils, and must not — a fuzzy match between "SCIM user/group
    lifecycle" and a pack keyed `okta.scim` is exactly the reasoning that publishes a claim nobody
    checked. It does not need to. A family is supported when a certified capability fulfils it,
    the certified set is empty, and an empty set covers no family whatever the names are. The test
    refuses a matrix that reports a supported capability without naming it in §1.
  - Caller: `tests/architecture/int-connector-capability-matrix.test.mjs` imports it and runs it
    with `--check`; `tools/run-platform-tests.mjs` discovers that file and
    `.github/workflows/ci.yml:88` runs `npm run test:platform`.
  - Tests: `tests/architecture/int-connector-capability-matrix.test.mjs`, 13 tests, bare
    `node --test`, 13/13 green. Almost all of its length goes on ONE failure mode: a document
    saying "nothing is supported" is the easiest kind to fake, because a parser that matches
    nothing produces exactly that page and then passes a byte comparison against itself forever.
    So every count is re-derived by a different traversal — `^ {2}pack\(\{$` construction sites
    and `^ {4}key: "…"` declarations for the packs, the constructor calls inside the
    `PAYMENT_CAPABILITIES` literal for payments, `^ {4}modelId: "` for models, and §7's bullets
    sliced out of the Bible and counted — and every parser is additionally driven with a fixture
    that DOES declare a supported thing: a pack at `capabilityStatus: "AVAILABLE"` on a
    `PUBLISHED` lifecycle, both payment constructors, and a `provider: "bedrock"` model that must
    read as in-account. It also asserts no leaf in the payments registry overrides `state:` (the
    matrix reads state from which constructor built the leaf, so an override would report a GA
    capability as planned), that every blocker names a subject present in a registry, that the
    blocker count equals the count of unavailable things, that no token-shaped value reaches the
    document, and that no line opens `ID — text`.
  - Evidence — mutations, 3 applied, 3 caught, all restored, 13/13 green after each:
    (1) **the generator goes current-but-false.** In `parsePacks`, replaced
    `status: field(block, 'capabilityStatus') ?? 'PLANNED'` with `status: 'PLANNED'`. Every pack is
    PLANNED today, so the regenerated document is BYTE-IDENTICAL and `--check` passes — the matrix
    would go on reporting "0 of 24 supported" the day somebody shipped a connector. Caught:
    `not ok 7 - a supported connector capability would be seen, and named`, verbatim
    `+ 'PLANNED'` against `- 'AVAILABLE'`. Restored, 13/13. This is the mutation the file exists
    for.
    (2) **a parser half-blinds itself.** Narrowed the payments constructor pattern from
    `(planned|unsupported)\(\s*"` to `(planned)\(\s*"`, dropping the five UNSUPPORTED leaves.
    Caught: `not ok 3 - every payment capability leaf has a row, and its state comes from one
    place`, verbatim `24 !== 31`. Restored, 13/13.
    (3) **the document goes stale.** Deleted the `| \`asana.work\` | …` row from
    `docs/architecture/int-connector-capability-matrix.md`. Caught: `not ok 1 - the committed
    matrix matches the registries`. Regenerated, 13/13.
  - On the word "final": the matrix is regenerated from the registries on every run and CI fails
    when it drifts, so it is final in the only sense that survives — it is never a snapshot of the
    day somebody wrote it. It is not a certification (it reports the state each registry declares;
    nothing here inspects a provider), and it is not a traffic measurement (no figure came from an
    AWS account; `docs/architecture/int-integration-inventory.md` records why that cannot be
    answered from this repository).

- [ ] **INT-GATE-000** — Current integration truth and authority are evidenced.
  - Status: FAIL
  - **3 of 4** children pass. INT-000-001 (the derived integration inventory), INT-000-003 (all 65
    `INT-*` requirements imported and both-directions checked) and INT-000-004 (the plane's domain
    ownership and its write boundary, 15/15 with three caught mutations) are PASS. INT-000-002 is
    `BLOCKED_EXTERNAL`: producer/consumer and the orphan/false-green-alarm findings are done and
    guarded, and "actual traffic" cannot be measured from this repository — it needs read-only
    CloudWatch access for the account that owns the estate, and that row names the exact commands.
  - The gate stays FAIL rather than inheriting the blocked child's status, deliberately. "Current
    integration truth is evidenced" is a claim about the whole of INT-000, and one quarter of it is
    a proof about the repository standing in for a fact about production: 5 of 5 SQS queues have no
    producer in the tree, which is not the same sentence as "no message has ever flowed", and the
    inventory's own preamble refuses to write the two as one. A gate that passed on 3 of 4 would be
    this programme's characteristic failure in miniature.
  - Evidence: `node --test tests/architecture/int-integration-inventory.test.mjs
    tests/architecture/int-requirements-are-imported.test.mjs
    tests/architecture/int-connector-write-boundary.test.mjs` — 15 + 6 + 15 = 36 tests, 36/36 green.
    Unblocking is one human action: grant a read-only role and name the account and region, then
    run the commands INT-000-002 lists.

- [ ] **INT-GATE-010** — Runtime is durable, traceable and tenant-safe.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Integration_Ecosystem_and_Connector_Certification_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **INT-GATE-020** — Only admitted connectors run.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Integration_Ecosystem_and_Connector_Certification_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **INT-GATE-030** — Auth and credentials are least-privilege and lifecycle-managed.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Integration_Ecosystem_and_Connector_Certification_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **INT-GATE-040** — Data meaning and lineage survive integration.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Integration_Ecosystem_and_Connector_Certification_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **INT-GATE-050** — Every transport handles failure and lifecycle explicitly.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Integration_Ecosystem_and_Connector_Certification_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **INT-GATE-060** — Operational failure is contained, visible and reconcilable.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Integration_Ecosystem_and_Connector_Certification_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **INT-GATE-070** — Operators can configure and operate integrations professionally without provider consoles for routine work.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Integration_Ecosystem_and_Connector_Certification_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **INT-GATE-080** — Integration breadth is cataloged and enabled only at proven depth.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Integration_Ecosystem_and_Connector_Certification_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **INT-GATE-090** — Every active connector is certified and operationally owned for exact scope.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Integration_Ecosystem_and_Connector_Certification_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **INT-GATE-100** — Integration Plane is production-ready only for exact evidenced capabilities.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Integration_Ecosystem_and_Connector_Certification_Claude_Bible_v1.0.md`; not yet implemented
