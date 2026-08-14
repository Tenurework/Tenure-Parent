# NEXT SESSION — Tenure-Parent

Written 2026-08-07. Read this file **first**, in full, before any tool call.

---

## 0. HARD RULES — non-negotiable, no exceptions

These are not preferences. Breaking one is worse than doing nothing.

### 0.1 Repository

| Rule | Detail |
|---|---|
| Push target | `origin` = `github.com/Tenurework/Tenure-Parent`, branch `main`. **Only this.** |
| Never touch | `live` = `github.com/satvikOS/Tenure`. Live pilot, real student data. No push, no commit, no deploy path. PR only, merged by a human. |
| Never remove | `if: github.repository == 'Tenurework/Tenure'` in `.github/workflows/**`. That guard being present is what stops a merge here rolling production. |
| Never | force-push, rewrite published history, bypass branch protection. |
| Verify first | `git remote -v` before any push. |

### 0.2 Guards and ratchets

**Never weaken a guard to make a build pass.** This has already been tested twice
this programme and both answers are recorded:

- `RAW_WRITE_CEILING` in `tests/security/audit-writes.test.mjs` counts *real
  unvalidated audit writes*. It may **only shrink**. Two new writes pushed the
  count to 36 against a ceiling of 34; the writes were converted to
  `buildAuditRecord` and the ceiling came **down to 32**. Raising it would have
  been the forbidden move.
- `DATABASE_EXEMPT.size` in `tests/architecture/forbidden-clients.test.mjs`
  counts *reasoned test exemptions* and its assertion says "have not grown
  **silently**". Bumping 12→13 **with the reason recorded beside the entry** is
  sanctioned. Different guard, different intent — do not treat them alike.

Read the guard's own wording before deciding which kind you are looking at.

### 0.3 Safety

- Do not retrieve, print, copy or rotate **secret values**.
- Do not print customer data, Simon student data, tokens, or unrestricted logs.
- Do not execute payments, payroll, bank instructions or Stripe money movement.
- No destructive production migrations.
- Do not delete a tenant, close an account, revoke production keys, notify
  customers, or retire a legacy system without human approval.
- **Never treat an AI, agent, operator, or test result as human approval.**
- Do not send customer records to direct external model APIs.
- Blocked → mark **only that scope** blocked and continue everything else.

### 0.4 Deletion — learned the hard way

**Before deleting or setting aside any file or directory, verify it is not
pre-existing.**

```bash
git log --oneline -1 -- <path>          # tracked and has history? then it is NOT new
git status --porcelain -- <path>        # "??" means untracked; anything else means tracked
```

On 2026-08-07 six workflows were killed mid-flight and their partial packages
set aside. `packages/finops` was swept up with them. It was a **pre-existing
tracked package**, `git add -A` committed the deletion, and Deploy Studio went
red with `Module not found: Can't resolve '@tenure/finops'`. Cost: one red
deploy plus a recovery commit (`234f430`).

`git add -A` after any bulk cleanup is how a deletion reaches a commit unnoticed.
Before committing a cleanup, stage it and then list what is being removed:
`git add -A && git diff --cached --name-status --diff-filter=D`
(`--diff-filter` is a `git diff` option — `git status` rejects it.)

---

## 1. TOKEN CONSERVATION — strict

Quota is the binding constraint on this programme, not capability. Both the
5-hour and weekly windows were exhausted on 2026-08-06/07.

### 1.1 Measured costs — use these, do not guess

| Unit | Cost |
|---|---|
| One requirement, implement + adversarial refute | **~180-200k tokens** |
| One survey agent over one domain slice | ~40-60k |
| 13 workflows × ~25 agents (the failed fan-out) | **23.7M tokens, zero code produced** |
| 5 queue waves, 34 agents, 17 items | ~2.1M, 10 requirements landed |

15% of 2,046 requirements ≈ 307 items ≈ **~60M tokens** at 1-item-per-agent.
That is ~2.5× what already exhausted the quota. **One item per agent cannot
reach a 15-20% wave.** Do not attempt it.

### 1.2 The lever is items-per-agent, not agents-per-wave

An agent's cost is dominated by reading itself into a file area, not by the
edit. Eight requirements in one area cost barely more than one.

`tools/loop/cluster-workflow.mjs` **has now had a full run**, and it works.
Measured, PACK domain, 2026-08-07:

| | |
|---|---|
| Agents | 16 (4 surveyors, 6 clusters, 6 refuters) |
| Tokens | **4.04M** |
| Wall clock | ~94 min |
| Requirements attempted | 28 |
| Confirmed by refuter | **17** |
| Refuted (reclassified FAIL) | 2 |
| Honest FAIL from the agent itself | 9 |

**~144k tokens per confirmed requirement**, against ~180-200k at one item per
agent — and that is with the refuter included. The refuters are worth their
share: they caught two claims that were false, one of which was a total outage.

A third defect got through both the agent and its refuter and was caught only by
the Studio Playwright suite. **Run both e2e suites after every domain lands.**

### 1.2b THE SURVEY IS NOT FREE, AND IT IS SPENT FIRST

**2026-08-07: three cluster runs launched together, all three died. ~4.2M tokens,
zero requirements landed.** The twelve surveyors finished; all fifteen cluster
agents failed with `You've hit your session limit`. This is the 13-workflow
failure again at a fifth of the size, and the reason is structural, not bad luck.

`cluster-workflow.mjs` spends survey FIRST and implementation SECOND. Survey is
~30-35% of a run's cost and produces **nothing durable** — no code, no ledger
entry, and the findings die with the workflow. So a run that is killed anywhere
in its second phase loses everything it paid for in the first.

| | PACK (completed) | CFG+WRK+PAY (died) |
|---|---|---|
| Tokens | 4.04M | **4.21M** |
| Requirements confirmed | 17 | **0** |

Both cost the same. One produced a domain.

**Rules that follow from this:**

1. **One domain at a time until the quota window is known to be fresh.** Three
   concurrent runs cannot finish inside a window that one run nearly fills.
2. **Check the window before launching.** A run needs ~4M tokens end to end. If
   you cannot be confident of that much, do not start one — start the smaller
   piece of work instead. There is always some.
3. **The survey is now persisted — this is DONE** (`4c7f3b9`). Each surveyor
   writes its slice to `tools/loop/surveyed-<domain>-<n>.json` before the implement
   phase begins, and a cheap agent replays those files on the next run instead of
   re-surveying. A death now costs the implementation only. `freshSurvey: true`
   re-buys a survey when the code has moved far enough to distrust old findings.
4. **`resumeFromRunId` will NOT save a run from a previous session.** It is
   same-session only, and no transcript survives the session anyway — see §2.4,
   where this was believed and was false. Disk is the only thing that outlives a
   session, which is why (3) writes to the repository rather than to a cache.

A cluster agent that dies mid-edit leaves the tree **broken, not empty**. One of
these left `packages/configuration/src/definition.ts` with `price` and `ui` made
REQUIRED and `description` removed — 47 type errors, every construction site
broken. That is the same "widening a type breaks its consumers" defect the rules
now warn about, delivered half-finished. Reverted; the draft is preserved at
`<scratchpad>/killed-waves/cfg/`, and it is worth finishing because priced config
options are the standing requirement in §7. **Always `npm run type-check` after a
workflow dies, before believing the tree is where you left it.**

### 1.3 Budget rules

1. **Never launch more than 3 workflows concurrently** without checking remaining
   quota first. The 13-workflow launch is what exhausted the session.
2. **Check `budget.total` / `budget.remaining()` inside workflow scripts** and
   scale cluster count from it, rather than hardcoding.
3. **Kill switch**: if the user says *calm down*, *limit*, *quota*, or *slow*,
   immediately `TaskStop` every running workflow and monitor, then report. Do not
   finish the current thought first.
4. **Do not poll.** Background tasks notify on completion. `Monitor` for external
   state only (CI), never for harness-tracked work.
5. **Grep before reading.** `Grep`/`Glob` cost a fraction of `Read`. Never read a
   2000-line file to find one symbol.
6. **Do not re-survey what is already surveyed.** `tools/loop/harvested-queue.json`
   holds 156 open GE requirements with `file:line` evidence, already paid for.
7. **Never run the full test suite to check one file.** Use
   `--testPathPattern "<area>"`. Full suite only in the final pre-push matrix.

---

## 2. WHERE THINGS ACTUALLY STAND — quantitative

### 2.0 Where the AWS control-plane work is (added 2026-08-14)

All of it is under `apps/system-studio/`, on branch `studio-program`. The service
readers are committed; the five new surfaces and the aggregation-module edits
were still uncommitted in the working tree when this was measured — agents do not
commit, the orchestrator does.

```
src/lib/aws/            the read plane — 50 modules, excluding tests. read.ts
                        (AwsRead<T>), capabilities.ts, client.ts, throttle.ts and
                        identity.ts are the spine; the per-service readers hang
                        off them; inventory, posture, health, drift, findings,
                        topology, tags, console-link and retained aggregate them.
                        mutate.ts is the ONLY mutation site and was not touched.
src/app/platform/       10 operator routes. estate, cost, security, audit and
                        health existed; compute, data, identity, messaging and
                        network are new this programme and are NOT yet linked
                        from the console navigation.
e2e/                    Playwright. aws-unknown-is-not-absent.spec.ts is the
                        STUDIO-000-007 proof; five new *-surface / *-page-logic
                        specs beside the new routes.
```

Studio unit tests run through **apps/web's jest**, not a jest of their own:
`npm run test --workspace apps/web -- --ci <path>`. `tests/**` at the repository
root is a third runner (`npm run test:platform`, plain `node --test`).
`apps/system-studio` must never import a Prisma client —
`tests/security/operator-plane-content.test.mjs` asserts it.

The accounting for all of it — which requirement each piece actually satisfies,
and which it does not — is the section headed **"Requirement reconciliation — the
AWS read/aggregation programme, 2026-08-14"** in
`docs/implementation/system-studio-aws-control-plane-execution-ledger.md`.

### 2.1 The honest denominator

Regenerate it — never quote from memory:

```bash
node tools/loop/next-batch.mjs | head -1
grep -c 'Status: PASS' docs/implementation/*execution-ledger.md | sort -t: -k2 -rn
```

| Metric | 2026-08-07, start | 2026-08-07, after that session | 2026-08-14, measured |
|---|---|---|---|
| Requirements the QUEUE could see | **1,219** | **2,046** | **2,265** |
| Decided | 133 | **145** | **248** |
| Remaining | — | — | **2,017** |
| `Status: PASS` lines, all ledgers | — | — | **234** |
| Ledgers with ZERO PASS | 13 of 15 | **12 of 15** | **3 of 16** |

The 2026-08-14 column is the verbatim output of the two commands above, run
against the tree with the AWS programme's uncommitted work in place:
`248/2265 decided · 2017 remaining`. Per-ledger `Status: PASS` counts, same run:
`global-engine 120 · payments-treasury 39 · system-studio 18 · erp-pack-factory
17 · tenant-experience 16 · universal-work-graph 12 · connection-composer 4 ·
declarative-configurator 3 · financial-management 1 · identity-eligibility-
entitlement 1 · operations-cloud 1 · people-hr-workforce 1 · planning-epm 1 ·
analytics-reporting 0 · integration-ecosystem 0 · simon-ose-absorption 0`.

**234 PASS lines and 248 decided are not the same measurement and must not be
reconciled to each other.** `decided` counts requirement ids the queue resolved
to `PASS`, `BLOCKED_EXTERNAL` or `NOT_APPLICABLE`; the `grep` counts the string
`Status: PASS`, which some rows carry with a qualifying clause after it.

**The AWS read/aggregation programme moved the decided count by zero.** It
delivered twenty-four service readers, five operator surfaces and eight
aggregation modules — real code, reached by real callers — and every one of them
was filed under an id that was either already decided (`STUDIO-070-004`,
`STUDIO-080-008`) or does not exist (172 invented ids in agent results, and five
invented headings written into the Studio ledger itself:
`STUDIO-070-011`, `STUDIO-080-009`, `STUDIO-080-010`, `STUDIO-DATA-001`,
`STUDIO-IDENTITY-001`). The reconciliation — every one of those mapped to the
requirement its evidence actually bears on, with a status — is the section headed
"Requirement reconciliation — the AWS read/aggregation programme, 2026-08-14" in
`docs/implementation/system-studio-aws-control-plane-execution-ledger.md`.
**The only source of requirement ids is `node tools/loop/next-batch.mjs --size
2100 --json`, plus the ids already carrying a ledger row.** An id in neither does
not exist.

**The denominator moved because the queue was blind, not because work was lost.**
`next-batch.mjs` named four prompts and three ledgers by hand; twenty-three
authorities and fifteen ledgers exist, so 755 requirements — every zero-PASS
domain — were not in the queue at all. It now derives both from
`tools/document-graph.mjs`, which discovers them from the filesystem. Adding a
Bible or a ledger needs no edit there.

Two more parsing defects fell out of that consolidation, both of which the queue
had already fixed in its own copy while the graph still had them: a bolded
`Status: **BLOCKED_EXTERNAL**` read as `FAIL` (eleven entries), and with the bold
readable, `GE-042-007` was ticked done while blocked — a false PASS among the 119.

Still at zero (2026-08-14, regenerated — the 2026-08-07 list of twelve is
superseded; nine of those twelve have since taken their first PASS):

```
analytics-reporting    integration-ecosystem    simon-ose-absorption
```

### 2.2 Test and guard baseline (must not regress)

**THIS TABLE LISTED EIGHT CHECKS AND CI RUNS TEN.** The two it omitted are the two
that reddened `main` on 2026-08-07 with all eight of these green. Updated to the
values at `3887c1f`:

| Check | Value at `3887c1f` |
|---|---|
| `npm run type-check` | 0 errors |
| `npm run studio:type-check` | 0 errors |
| `npm run lint` | 0 errors (pre-existing warnings only) |
| `npm run test --workspace apps/web -- --ci` | **4110 passing, 177 suites** |
| `npm run test:platform` | **311 pass, 0 fail** |
| `npm run test:isolation` | **185 pass, 0 fail** ← was missing |
| `npm ci --dry-run` | resolves ← was missing |
| `npm run build` | apps/web compiles |
| `npm run build --workspace apps/system-studio` | compiles |
| apps/web Playwright | **175/175** on a fresh migrate+seed |
| Studio Playwright | **208/208** on a pristine registry table AND a Studio started with the operator env |

**The last two are not optional and are not blocked.** They are the only checks
that caught either of the two total outages in the PACK run — both invisible to
`tsc`, both green in every unit test. See §8 for how to run them; it takes
minutes, not the "record the operator commands" this file used to advise.

`adoption.spec.ts` (Studio) and the apps/web suite are **not idempotent**. A
reused table or database fails them; a fresh one passes. Re-create before
believing a failure. `test:isolation` is the same — its 19 `*.itest.ts` files
mutate seeded rows, so a second run without re-seeding fails on state, not code.

**The Studio suite has no `webServer`.** `apps/system-studio/playwright.config.ts`
starts nothing; you must run `npm run start --workspace apps/system-studio`
yourself with the operator env, and pass that env to the Playwright process too.
Eight "failures" on 2026-08-07 were a Studio left running from an earlier session
against a DynamoDB table that already had `rochester` adopted. Kill whatever holds
`:3100` and recreate the table before believing anything that suite says.

### 2.2b THE GUARDS ONLY SEE TRACKED FILES

`test:platform` was **307/307 before `git add` and 303/307 after it**, with no
code changing in between. The architecture and security guards enumerate through
`git ls-files --cached`, so 158 new files were invisible to every one of them.

**Stage first, then verify.** Verifying a working tree measures a repository that
does not contain the work being verified.

The same shape, one layer out: nothing local runs `npm ci`, so a workspace
missing from `package-lock.json` passes all ten checks above and kills every CI
job on its first step. `tests/architecture/lockfile-knows-every-workspace.test.mjs`
now catches that inside `test:platform`; it did not exist when it was needed.

### 2.3 Commits, 2026-08-07 (second session)

All CI-green on `main`. Every one of these was a guard or a tool pointed away
from where the work actually is.

| SHA | What | CI |
|---|---|---|
| `0900c8f` | 12 ledgers advertised `BLOCKED_ARCHITECTURE`, which the queue cannot act on | green |
| `71beac8` | The queue could not see 755 of 2,046 requirements | green |
| `d9dd487` | AI-mark colour debt closed on the token; exception deleted not renewed | green |
| `6bae247` | e2e restore race — the spec that failed CI three times | green |
| `6846a12` | This file's "database unavailable" corrected | green |
| `c97b71c` | PACK: 17 requirements, 2 refuted, 2 total outages caught | green + Deploy Studio green |
| `722a3c9` | Cluster-workflow rules: type widening, producer mutation, run the e2e | green |
| `64e10c0` | This file: measured cluster cost, real baselines | green |

### 2.4 THE THREE KILLED RUNS ARE NOT RESUMABLE — their surveys are gone

**Corrected 2026-08-07 (third session). The previous version of this section said
these three runs were resumable and their surveys paid for. Both halves are
false, and acting on it would have bought nothing at full price.**

```
CFG  wf_3433d090-a1c   declarative-configurator   79 requirements
WRK  wf_1607725c-3a6   universal-work-graph       88 requirements
PAY  wf_c59c18fa-cc9   payments-treasury         224 requirements
```

`resumeFromRunId` is **same-session only** — the tool contract says so, and these
ids belong to a session that ended. Nor is there anything left on disk to replay:

```bash
find "$LOCALAPPDATA/Temp/claude" -name journal.jsonl -o -name 'agent-*.jsonl'
```

returns nothing for any of the three. No transcript, no cache, no findings. The
4.21M tokens bought exactly what the ledger shows: nothing.

**The fix landed instead** (`4c7f3b9`). Surveyors now write their slice to
`tools/loop/surveyed-<domain>-<n>.json` before the implement phase starts, and a
cheap agent replays those files on the next run — so the survey survives the
session, the machine, and the quota. Pass `freshSurvey: true` to re-buy one
deliberately when the code has moved far enough that old findings should not be
trusted. Nothing else needs the dead run ids; they are kept here only so the next
session recognises them and does not try.

The three focus strings below are the part that was genuinely worth keeping, and
they are re-usable as-is.

The three focus strings carried real, verified defects that are still open, so
they are worth re-supplying even if you do not resume:

- **CFG** — REVIEW-FINDINGS P2 #19, a **privilege escalation**:
  `finance.roleNamePatterns` is a tenant-writable config key that decides
  `canManageFinance`, classified `sensitivity: "standard"` with no
  `requiresCapability`, and its guard regex excludes none of `[a-z] .  ^ $`
  or backreferences while being run against attacker-controlled input. The
  document names the fix (case-insensitive substrings, not regex) and ships the
  regex anyway.
- **WRK** — REVIEW-FINDINGS P1 #16: `redirect()` inside `withTenant` is a
  Next.js control-flow throw; inside `db.$transaction` it aborts the transaction
  and **silently rolls back writes**. Server actions here end with `redirect(...)`.
- **PAY** — REVIEW-FINDINGS P0 #7: `ApprovalRequest.idempotencyKey` is a
  client-supplied **global** unique (`schema.prisma:391`), so a collision makes
  tenant B's retry resolve to tenant A's approval. A cross-tenant leak, not a
  collision.

## 3. QUALITATIVE — what was actually fixed, and what it means

Ten requirements landed. Seven survived independent refutation. These were real
defects in shipped code, not scaffolding:

- **GE-010-007** — a cell running `AWS_PARTITION=aws-cn` or `aws-us-gov` reported
  the AI assistant available on the strength of an API key and posted tenant
  content to `api.anthropic.com`, which exists in **neither partition**. A data
  residency violation. Now gated by an explicit partition/service matrix; an
  unrecognised partition offers nothing rather than defaulting to commercial AWS.
- **GE-042-004** — sessions had **no `maxAge` at all**, running NextAuth's default
  30-day *sliding* window. Now idle-bounded by the identity engine and
  absolute-bounded by `token.authAt`, stamped once at sign-in, never re-stamped.
- **GE-094-008** — an OSE member could **approve their own request**. `mayDecide`
  existed in `@tenure/authorization` and reached no approval path.
- **GE-085-006** — `seed.mjs` claimed "safe to run on every container start" while
  issuing an unscoped `db.approvalDelegation.deleteMany({})`. Protection was
  prose in `entrypoint.sh` plus an unset env var.
- **GE-074-004** — the calendar conflict gate ran *after* `db.event.update`.
- **GE-080-007** — money parsed as `Math.round(value * 100)` on a float.
- **GE-062-004** — search returned rows past the reader's clearance ceiling.

### 3.1 Three lessons that cost real tokens to learn

**A caveat a parser cannot see is not a caveat.** An agent wrote
`Status: PASS for the append-only half` — honest prose. Both
`tools/reconcile-execution-checkboxes.mjs` and `tools/loop/next-batch.mjs` parse
with `/Status:\s*\*{0,2}([A-Z_]+)/` and extract `PASS`. The unbuilt half would
have been ticked done and dropped from the queue permanently. A refuter proved it
by running `ledgerState()`. **Status tokens are machine-read: `PASS`, `FAIL`,
`BLOCKED_EXTERNAL`, `NOT_APPLICABLE` and nothing else on that line.**
`BLOCKED_ARCHITECTURE` is **not** accepted — `tests/architecture/ledger-statuses.test.mjs`
rejects it, and it is right: half-done is `FAIL` if the rest can be built now.

**File-ownership isolation guaranteed nothing could be finished.** Confining each
agent to one package prevented collisions and made every package requirement end
blocked at the `apps/web` boundary — three for three. Cache invalidation with no
cache constructed; an audit chain whose writers never pass a sequence. **A cluster
must own its consuming call sites**, which `cluster-workflow.mjs` now enforces.

**A mock that returns a canned value proves nothing.** A test of mine passed
whether or not production filtered on `serving`, because its mock returned `[]`
regardless. Only mutation caught it. Stand-ins must honour the query.

---

## 4. TOOLING — built and ready

| File | Purpose | Status |
|---|---|---|
| `tools/loop/cluster-workflow.mjs` | Survey a domain → implement in **clusters** (one agent, many requirements, owns its call sites) → adversarial refute | **Proven: PACK, 17 confirmed. Survey now persists to disk. Use this.** |
| `tools/loop/surveyed-<domain>-<n>.json` | A finished survey, written by the surveyors before implementation starts | Replayed automatically; the reason a killed run no longer pays twice |
| `tools/loop/queue-workflow.mjs` | Implement pre-surveyed items 1:1 | Proven; 5 waves, 10 landed |
| `tools/loop/domain-workflow.mjs` | Survey + implement one domain | Proven for survey |
| `tools/loop/plan-waves.mjs` | Partition a queue into collision-free waves | Working |
| `tools/loop/harvested-queue.json` | **156 open GE requirements with file:line evidence** | Already paid for — reuse |
| `tools/loop/bible-watch.mjs` | 30-min re-read heartbeat + new/changed authority detection by SHA | Working, currently stopped |

**`args` arrives as a JSON STRING, not an object.** All three workflow scripts now
parse it. `const D = args || {}` silently left every field `undefined`, so 13
workflows all fell through to the same default domain and did identical work. If
you write a new script, copy the parsing block.

---

## 5. OPEN FINDINGS — precise, verified against code

| ID | Finding | Location |
|---|---|---|
| GE-053-006 | `authorizationService` has **no production caller**. Cache invalidation is correct and unreachable. `decide()` **is** wired (3 sites) — uncached, which is the safer design. Do not add a cache to tick a box. | `packages/authorization/src/service.ts` |
| GE-063-004 | Audit chain **never continuous in production**. `record.ts:353` gates `_sequence`/`_previousHash` behind `if (sequence !== null)` and neither writer passes them. Only a per-row hash is live — the exact control the code says a row-editing attacker defeats. `verify.ts`/`retention.ts` (565 lines) have one caller: their own test. | `apps/web/src/lib/admin/guard.ts:70`, `apps/web/src/lib/provisioning/reconcile.ts:368` |
| GE-063-001 | 32 of 38 audit writes bypass the validated builder. `audit-record.ts` (~460 lines carrying seat, change digest, prior hash) has zero importers. | `apps/web/src/lib/audit-record.ts` |
| — | `Institution.serving` collapses every refusal into one bit. Bible §6.2: *"A single `is_active` boolean is prohibited."* REVIEW-FINDINGS §21 agrees. Needs `servingState` beside it: structured reason for a member, plain 404 for a non-member. | `apps/web/src/lib/tenant-scope.ts` |
| — | No account-disable exists. `disabledAt` is on `Principal` in `packages/authorization` only, not on `User` in the schema. | `apps/web/prisma/schema.prisma` |
| — | `TenureAIPanel.tsx:121` paints the AI mark `#25a96d` — not `--primary`, not any token. Found by the new design-token lint. | `apps/web/src/components/ai/TenureAIPanel.tsx` |
| GE-051-005 | Ratchet still at **30** unauthorized mutating paths. | — |
| STUDIO-080-006 | `estateDrift` — the whole Terraform-declared-versus-observed drift engine, with `parseTerraformEstate`, `observedBuckets`, `observedSecurityGroups`, `observedUserPools`, `observedTables` — **has no production caller**. Reached from its own test file only. No operator can see drift. | `apps/system-studio/src/lib/aws/drift.ts` |
| STUDIO-080-006 | Ignore-with-expiry and recurrence detection are **unreachable in production**. Neither caller of `compareDesiredToActual` (`app/page.tsx:428`, `app/tenants/[slug]/page.tsx:377`) passes a `history`, so `history.ignored` is permanently empty and `occurrences` is always 1. `app/tenants/[slug]/page.tsx:1203` **renders that 1 as a recurrence count**, which it is not. `driftIgnore` / `ignoreItem` / `activeIgnores` have no caller outside `e2e/aws-unknown-is-not-absent.spec.ts`. | `apps/system-studio/src/lib/aws/drift.ts:186`, `app/tenants/[slug]/page.tsx:1203` |
| STUDIO-110-006 | `findingsPipeline` / `assemblePipeline` / `pipelineLines` / `mergeContributions` — the five-source normalisation and dedupe pipeline — have **no caller anywhere in the repository, including their own test file**. `/platform/security` still calls only the older `securityFindings()`. | `apps/system-studio/src/lib/aws/findings.ts` |
| STUDIO-120-003 | `fleetHealthVerdict` **has no production caller**. `observeFleet` / `observationsFor` in the same module are reached; the verdict built on top of them is not. | `apps/system-studio/src/lib/aws/health.ts` |
| STUDIO-080-002 | `tenantWiring` / `wiringReadings` — the resource wiring graph — **have no production caller**. `reconcileTopology` in the same file IS reached; the wiring half is not. | `apps/system-studio/src/lib/aws/topology.ts` |
| — | Studio aggregation tests are **RED as of 2026-08-14**: `posture.test.ts` 1 failed, `findings.test.ts` 3 failed (all three in the dedupe/corroboration group), `drift.test.ts` 1 failed. 296/300 across the seven aggregation suites, plus 39/40 in drift. These were green-adjacent claims in agent results; they are not green. | `apps/system-studio/src/lib/aws/{posture,findings,drift}.test.ts` |
| — | `apps/system-studio/src/lib/aws/console-link.ts` is real, tested and reached from `/platform/estate`, and **matches no requirement id in any Bible**. A coverage gap in the programme, not in the code. Do not mint an id for it; if it is wanted, it needs a Bible clause first. | `apps/system-studio/src/lib/aws/console-link.ts` |

**The probe that produced the five "no production caller" rows**, so the next
session can re-run it rather than trust it:

```bash
grep -rl "\bestateDrift\b" apps/system-studio/src/app     # empty  -> no caller
grep -rl "\bsecurityFindings\b" apps/system-studio/src/app # 2 files -> probe works
```

**`docs/architecture/REVIEW-FINDINGS.md` overrides `PLATFORM-ARCHITECTURE.md`
wherever they disagree.** It is 73 lines. Read it in full — it is cheap and it
names 11 P0 defects. P0 #4 is already closed in `decide.ts:166,181`.

---

## 6. PRESERVED WORK — do not re-derive

Killed mid-flight, kept rather than discarded:

```
<scratchpad>/killed-waves/payments/     partial packages/payments (PAY workflow)
<scratchpad>/killed-waves/analytics/    partial apps/web/src/lib/analytics (ANL)
<scratchpad>/agent-scratch/             AI/a11y cluster patch + registry analyses
```

Scratchpad root:
`C:\Users\satvi\AppData\Local\Temp\claude\C--Users-satvi\48abdb25-e006-4e1c-8dfa-05b6eebc26c2\scratchpad`

These are **unverified** — written by agents that died before reporting. One left
`acceptsWrites` in `rbac.ts` with an elaborate comment claiming `tsc` enumerates
every write path, and **zero callers**. Treat as drafts; verify before trusting.

---

## 7. STANDING PRODUCT REQUIREMENT — cost transparency

Every configuration option a tenant chooses, at **every stage** of setup, must
carry a price tag — **per seat AND for the whole organisation** — with a running
total, so cost is never a surprise at the end.

Three owned areas:
1. `packages/finops` — pricing engine. Integer minor units, **never floats**,
   explicit currency and rounding. Quoting only; **no money movement**.
2. `packages/configuration` + `packages/platform-config` — priced metadata on the
   option model; resolver returns running cost beside resolved configuration.
3. `apps/system-studio` — renders it. Must keep `e2e/layout.spec.ts` green:
   off-white `#f2f0ed` on muted grey `#33302c`, no pure white or black.

A new config option without a price is incomplete. Prove it with a test that reds
when the price is removed.

---

## 8. THE LOOP — run this, in this order

```bash
cd /c/Users/satvi/Tenure-Parent
git remote -v                                   # confirm origin, never live
gh run list --limit 6                           # red on main? that is the ONLY work
```

**A red build is the next tick's only work.** Fix one workflow at a time.

Then:

1. Read `docs/architecture/REVIEW-FINDINGS.md` **from disk** (73 lines).
2. `node tools/loop/plan-waves.mjs --histogram` — see where open work concentrates.
3. Launch **at most 3** `cluster-workflow.mjs` runs on zero-PASS domains.
4. When they land: check every `PASS` has `refuted: false` from its refuter.
   Reclassify anything else to `FAIL` in the ledger, with the reason.
5. Full matrix — **all six, no shortcuts**:

```bash
npm run type-check                                  # must be 0
npm run lint
npm run test --workspace apps/web -- --ci           # >= 3184
npm run test:platform                               # 216 pass, 0 fail
npm run build                                       # apps/web
npm run build --workspace apps/system-studio        # ← the one that was missed
```

6. `git add -A && git diff --cached --name-status --diff-filter=D` — **confirm
   nothing is being deleted that you did not intend**. Empty output is the
   expected result.
7. Commit, push to `main`, wait for **green** (not red, not skipped, not cancelled).
8. Regenerate: `node tools/document-graph.mjs`,
   `node tools/reconcile-execution-checkboxes.mjs`, `node tools/ownership-map.mjs`.

### Database — AVAILABLE. Check before believing otherwise.

**This section previously said Postgres was unavailable ("no Docker daemon,
nothing on 5432/5433") and it was wrong on 2026-08-07.** Docker was up, and the
*previous session's own containers* were still listening on 5433, 5434 and 5439.
Two e2e behaviours were guessed at rather than run, and the guesses cost three
red CI runs on a test that takes 19 seconds to run locally.

**Check, do not inherit the claim:**

```bash
docker info >/dev/null 2>&1 && echo up          # daemon
docker ps                                        # containers already running
netstat -an | grep -E "543[2-9]"                 # anything listening
```

Standing one up, verified end to end on 2026-08-07 (migrate + seed + 11/11 in
`resources.spec.ts`):

```bash
docker run -d --name tenure-verify-pg -e POSTGRES_USER=tenure \
  -e POSTGRES_PASSWORD=tenure -e POSTGRES_DB=tenure -p 5455:5432 postgres:16
export DATABASE_URL="postgresql://tenure:tenure@localhost:5455/tenure"
cd apps/web && npx prisma migrate deploy && node scripts/seed.mjs
npx playwright test e2e/<one>.spec.ts        # one spec, not all 30, while iterating
```

The e2e run also needs the auth env CI sets — `AUTH_SECRET`, `AUTH_TRUST_HOST`,
`AUTH_DEV_LOGIN`, `ALLOW_DEV_LOGIN_IN_PRODUCTION`, `DEV_LOGIN_PASSPHRASE`,
`TENANCY_ENFORCE`, `NEXTAUTH_URL`, `JOB_SECRET`, `AWS_REGION`, `IMAGE_TAG`. Copy
them from `.github/workflows/ci.yml`.

**30 e2e specs and 12 `*.itest.ts` were treated as unrunnable on this ground.
They are runnable.** No ledger entry names the database as its blocker — checked,
`grep -A6 BLOCKED_EXTERNAL` over all fifteen ledgers returns nothing about
Postgres or Docker — so nothing needs reclassifying. What was lost was
*verification*: a whole class of proof was skipped as impossible while it was
available, and "record the operator commands and move on" was the wrong answer to
a database that was already running.

The e2e suite is **not idempotent** — re-seed between runs.

---

## 9. THE STANDARD — every claim

- **Real code reached by a real production caller.** A type, interface or helper
  nothing calls is dead code. Dead code carrying a comment that claims otherwise
  is worse than nothing. **Name the caller or return blocked.**
- **Mutation-prove every test.** Apply a mutation, run it, *confirm it fails*,
  restore, confirm it passes. Report the mutation and both results.
- **Always verify the baseline is green before trusting a mutation result.**
- **If a comment or evidence string is false, fix the claim — not the test.**
- **Do not mark PASS what is not true.** A requirement titled "signed X" is not
  PASS while X is unsigned. An honest `FAIL` outranks a false `PASS`.
- **Report faithfully.** If tests fail, say so with the output. If a step was
  skipped, say that.
