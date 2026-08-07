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
Run `git status --porcelain --diff-filter=D` before committing a cleanup.

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
edit. Eight requirements in one area cost barely more than one. Use
`tools/loop/cluster-workflow.mjs`, which is built for exactly this and has
**never had a full run** — it was launched and killed within the hour.

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

### 2.1 The honest denominator

| Metric | Value |
|---|---|
| Requirements across all Bibles | **2,046** (16 domain prefixes, 23 authority documents) |
| PASS | **~132** (~6.5%) |
| Undecided | 841 |
| **Ledgers with ZERO PASS** | **13 of 15** |

**The platform is ~6% complete, not 10%.** 122 of the PASS entries live in two
ledgers (`global-engine` 119/432, `system-studio` 3/18). These 13 have nothing:

```
payments-treasury            224   universal-work-graph          88
declarative-configurator      79   integration-ecosystem         65
connection-composer           59   erp-pack-factory              53
financial-management          34   tenant-experience             34
people-hr-workforce           33   operations-cloud              32
analytics-reporting           27   planning-epm                  27
simon-ose-absorption          14
```

Regenerate the true numbers — never quote from memory:

```bash
node tools/document-graph.mjs
for f in docs/implementation/*execution-ledger.md; do
  printf "%4s %s\n" "$(grep -c 'Status: PASS' "$f")" "$(basename $f)"; done
```

### 2.2 Test and guard baseline (must not regress)

| Check | Value at `234f430` |
|---|---|
| `npm run type-check` | 0 errors |
| `npm run lint` | clean |
| `npm run test --workspace apps/web -- --ci` | **3184 passing, 130 suites** |
| `npm run test:platform` | **216 pass, 0 fail** |
| `npm run build` | apps/web compiles |
| `npm run build --workspace apps/system-studio` | compiles |

### 2.3 Commits this session

| SHA | What | CI |
|---|---|---|
| `8152933` | `ACTIVATING` actually gates reachability (`Institution.serving`) | red → fixed |
| `13dc466` | `serving` in untyped `.mjs` fixtures | red → fixed |
| `2583a8d` | Archived clubs stop taking writes (GE-085-004) | **green** |
| `892a167` | Ten requirements, seven refuter-confirmed | CI green, Deploy Studio red |
| `234f430` | Restore wrongly-deleted `packages/finops` | verify on next run |

---

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
| `tools/loop/cluster-workflow.mjs` | Survey a domain → implement in **clusters** (one agent, many requirements, owns its call sites) → adversarial refute | **Never completed a run. Use this.** |
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

6. `git status --porcelain --diff-filter=D` — **confirm nothing is being deleted
   that you did not intend**.
7. Commit, push to `main`, wait for **green** (not red, not skipped, not cancelled).
8. Regenerate: `node tools/document-graph.mjs`,
   `node tools/reconcile-execution-checkboxes.mjs`, `node tools/ownership-map.mjs`.

### Blocked externally

Postgres is unavailable on this host — no Docker daemon, nothing on 5432/5433.
All `*.itest.ts` and Playwright e2e are `BLOCKED_EXTERNAL`. Record the exact
operator commands and do the non-database work fully:

```bash
docker run -d --name tenure-pg -e POSTGRES_USER=tenure -e POSTGRES_PASSWORD=tenure \
  -e POSTGRES_DB=tenure -p 5433:5432 postgres:16
export DATABASE_URL="postgresql://tenure:tenure@localhost:5433/tenure"
cd apps/web && npx prisma migrate deploy && node scripts/seed.mjs && npx playwright test
```

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
