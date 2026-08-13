# NEXT SESSION — Tenure-Parent

Rewritten 2026-08-13. Read this file **first**, in full, before any tool call.

It replaces the 2026-08-07 version wholesale. Where a number appears here it was
measured on 2026-08-13, not remembered.

---

## 0. THE FIRST FIFTEEN MINUTES

Do these in order. Do not skip to the interesting work.

```bash
cd /c/Users/satvi/Tenure-Parent
git remote -v                                   # origin = Tenurework/Tenure-Parent. NEVER live.
git fetch origin && git status -sb               # behind? another author has been working
gh run list --branch main --limit 4              # red on main is the ONLY work until it is green
npx tsc --noEmit -p apps/system-studio/tsconfig.json && npm run type-check
```

**A red `main` outranks everything in this document.** It is also usually cheap —
five of the last six reds were a generated artefact, not a defect. §5 tells you
which.

Then decide between two modes:

| If | Then |
|---|---|
| `wip/studio-program-20260813` still exists on origin | §1 — finish it before starting anything new |
| It has been merged or abandoned | §3 — pick the next domain and launch |

---

## 1. WHERE THE WORK ACTUALLY IS RIGHT NOW

`main` is `a2aa1b6`, clean, everything pushed.

**`origin/wip/studio-program-20260813` is the live front.** 88 files, stopped
mid-flight when the machine had to close — deliberately stopped, not crashed.

Landed on it and PLAUSIBLE but **unrefuted**:

- All seven previously-missing AWS readers: `ses`, `sqs`, `lambda`, `iam`,
  `budgets`, `aws-health`, `eventbridge`. Terraform *provisions* SES and SQS, so
  before this the engine created resources it could not see.
- The Material 3 layer: token ramp, and the primitives `Surface`, `Card`,
  `Button`, `Chip`, `Badge`, `DataTable`, `EmptyState`.
- Two design documents: `docs/architecture/studio-design-system.md` and
  `studio-information-architecture.md`.

**Not done, and why the branch is a branch:** the eleven route agents were
mid-migration, so some pages consume the primitives and some do not. No refuter
has run over any of it. Treat every claim on that branch as unverified.

Resume it — the nine reported agents replay from cache, so this is cheap:

```
Workflow({scriptPath: 'tools/loop/studio-program.mjs',
          resumeFromRunId: 'wf_206f4cc9-58e'})
```

The script is `tools/loop/studio-program.mjs`; its phases and file-ownership
split are documented in the file itself. **Ownership is what makes 18 concurrent
agents safe** — one file each, named in the prompt. Do not widen it.

---

## 2. THE THREE THINGS THE OPERATOR ASKED FOR, AND WHERE EACH STANDS

Verbatim, because the wording matters more than a paraphrase:

1. **"Wiring of AWS to Tenure global system is not at all fully completed
   (this is critical)."** The seven readers above close the measured gap: 20 SDK
   clients were wired, 7 services had none. Still open — mutations beyond the
   reversible set, per-tenant cost attribution end to end, and anything needing
   an AWS Organization the estate does not have.
2. **"The UIUX … is cluttered and looks like a construction site … put all these
   mess in one last tab."** The IA document exists. The *navigation* is not yet
   restructured and no route has been moved behind a final Diagnostics tab. This
   is the least-done of the three and the most visible.
3. **"Material design 3 … has to be implemented across for Tenure Studio only."**
   Tenant-side UI/UX is already defined and is NOT in scope. Foundation is in,
   adoption is partial.

---

## 3. THE HONEST DENOMINATOR

Regenerate it; never quote from memory:

```bash
node tools/loop/next-batch.mjs | head -1
grep -c 'Status: PASS' docs/implementation/*execution-ledger.md | sort -t: -k2 -rn
```

**220 of 2,265 decided, 2,045 remaining** on 2026-08-13. PASS, per domain:

```
GE 119   PAY 36   TTES 16   PACK 15   STUDIO 13   WRK 12   CFG 1   CAT 1
```

**Total** requirements per domain — the denominator each PASS count sits in:

```
GE 781   PAY 224   IER 219   EXT 186   STUDIO 167   SIMON 157
WRK 88   CFG 79    INT 65    CAT 59    PACK 53      FIN 34
TTES 34  HCM 33    OPS 32    ANL 27    PLN 27
```

**`FAIL` is the import default, not a verdict.** 1,231 of the 1,449 ledger rows
read `Status: FAIL` with `Reason: imported from <bible>; not yet implemented`.
So a FAIL tells you nothing about whether anything was ever attempted — read the
Reason, and if it still says "imported", treat the requirement as untouched.
Anything genuinely attempted and refuted names the refutation in its Reason.

`IER` (Identity, Eligibility, Entitlement, Roster, Access Continuity) arrived by
upload on 2026-08-08 and has **zero** decided. It carries REVIEW-FINDINGS **P0
#4**: the effective-permission SQL grants full authority to SUSPENDED and LEFT
members and disabled principals, and `DenyReason.MEMBERSHIP_SUSPENDED` ships with
no code path that can produce it.

---

## 4. WHAT A RUN ACTUALLY COSTS — the binding constraint is the quota window

| Measured | Value |
|---|---|
| One requirement, implement + refute | **~145k tokens** |
| A 16-agent cluster run, end to end | **~4M tokens, ~90 min** |
| Confirmed on 2026-08-07/08 | **11**, against ~45 claimed |

**Six runs have been killed by a limit.** On 2026-08-08 two runs died on the
**weekly** cap and returned 5.6M tokens for zero requirements. Before launching,
know which window you are in.

Rules that follow, and they are not negotiable:

1. **Never more than 3 cluster workflows concurrently.** The 13-workflow launch
   produced 23.7M tokens and no code.
2. **The survey persists.** Surveyors write `tools/loop/surveyed-<domain>-<n>.json`
   before implementation starts, and a cheap agent replays them next run. A
   killed run now costs the implement phase only. `freshSurvey: true` re-buys it.
3. **`resumeFromRunId` is same-session only** for cluster runs from a dead
   process — but the workflow *script* plus its run id do replay within a
   session. Check for a journal before assuming anything is recoverable:
   `find "$LOCALAPPDATA/Temp/claude" -name journal.jsonl`.
4. **Claimed is not confirmed.** Every PASS needs `refuted: false` from an
   independent refuter. Reclassify anything else to FAIL with the reason.

---

## 5. THE TEN CHECKS — CI runs ten and the old handoff listed eight

```bash
npm run type-check                                  # 0
npm run studio:type-check                           # 0
npm run lint                                        # 0 errors (warnings pre-exist)
npm run test --workspace apps/web -- --ci           # 4610+, 207 suites
npm run test:platform                               # 389 pass, 0 fail
npm run test:isolation --workspace apps/web         # 208 pass — NOT in the old list
npm ci --dry-run                                    # resolves — NOT in the old list
npm run build                                       # apps/web
npm run build --workspace apps/system-studio
# plus BOTH Playwright suites — see §7
```

### 5.1 Two traps that have cost five red builds between them

**The guards only see TRACKED files.** `test:platform` read 307/307 before
`git add` and 303/307 after, with no code changing: the architecture and security
guards enumerate through `git ls-files --cached`. **Stage first, then verify.**

**Generated artefacts must not depend on your working tree or your OS.** Five
reds came from this one idea wearing different clothes:

- sorting **native** paths (`\` 0x5C vs `/` 0x2F order differently);
- unsorted `readdirSync` (NTFS sorts, ext4 does not);
- hashing raw **CRLF** bytes, so a digest described the checkout not the document;
- the document walk picking up Playwright's `error-context.md` files;
- and — 2026-08-13, mine — **running `npm run generate` while 40 agent files sat
  uncommitted**, so the artefacts described a tree only that machine had.

If `--check` says stale in CI and current locally, it is one of these. Reproduce
it properly rather than guessing twice:

```bash
cd /tmp && rm -rf gcheck && git clone -q --depth 1 file://C:/Users/satvi/Tenure-Parent gcheck
cd gcheck && node tools/document-graph.mjs && git diff --stat
```

---

## 6. THE RULES THAT WERE BOUGHT WITH RED BUILDS

Put these in every agent prompt. Each names something that actually shipped.

1. **A guard that cannot fail is worse than no guard.** FIVE were found switched
   off: `if (false && verdict)` around the destructive-AWS-mutation gate,
   `if (false && !isPaymentMode(...))` around money-mode validation, `|| true`
   making a loop skip every key, `const refusals = [] // MUTATION` shipped in
   `signin/page.tsx`, and `false && CREDENTIAL.test(write)` making a credential
   sweep return empty for every file. **All five read green.**
2. **Never fabricate an approval.** An agent set `GRAPH_CALENDAR_REVIEW` to
   `APPROVED` with invented verification dates, in the file whose own comment
   argued that was the only untrue state. §0.3 forbids treating any agent or test
   result as human approval.
3. **Widening a type breaks consumers silently.** An optional field a caller
   omits is invisible to `tsc`. Grep every construction site and name them.
4. **A fixture must never delete a row it did not create.** One claimed the
   pilot's slug and deleted the seeded institution and all 26 of its clubs.
5. **A jest mock of `@/lib/db` must implement BOTH `$transaction` forms** — array
   AND callback — because `recordAuditEvent` appends the audit chain through the
   callback form. Re-state it inside `beforeEach`: `jest.clearAllMocks()` wipes
   implementations, not just call counts.
6. **`seed.mjs` does not reset the database.** It is upsert-based and deletes
   four things, so seats accumulate across "fresh" seeds — 235 → 250 → 265. Phantom
   failures come from this. Create a NEW database, do not re-seed.
7. **apps/web targets ES2017.** `/…/s` is a compile error; use `[\s\S]*`.
8. **A new workspace package must reach `package-lock.json`** or `npm ci` kills
   every CI job on its first step. `tests/architecture/lockfile-knows-every-workspace.test.mjs`
   now catches it locally.
9. **New audit writes go through `recordAuditEvent`.** `RAW_WRITE_CEILING` in
   `tests/security/audit-writes.test.mjs` is **32** and may only FALL. Same for
   every other ratchet — `UNAUTHORIZED_MUTATORS`, `UNCLAIMED`, `SHARED.size`,
   `DATABASE_EXEMPT.size`. Raising one to make a build green defeats its purpose.

---

## 7. RUNNING THE TWO PLAYWRIGHT SUITES

They are not optional. They are the only checks that caught either total outage
in the PACK run, and they caught a wedged route boundary, an unnamed form field
and a credential shown to a club member since.

**apps/web** — needs a genuinely fresh database (see rule 6):

```bash
docker run -d --name tenure-e2e-pg -e POSTGRES_USER=tenure -e POSTGRES_PASSWORD=tenure \
  -e POSTGRES_DB=tenure -p 5466:5432 postgres:16
cd apps/web && export DATABASE_URL="postgresql://tenure:tenure@localhost:5466/tenure"
npx prisma migrate deploy && node scripts/seed.mjs
# env: AUTH_SECRET AUTH_TRUST_HOST AUTH_DEV_LOGIN ALLOW_DEV_LOGIN_IN_PRODUCTION
#      DEV_LOGIN_PASSPHRASE TENANCY_ENFORCE NEXTAUTH_URL JOB_SECRET AWS_REGION IMAGE_TAG
npx playwright test          # 182 passed
```

**Studio** — has NO `webServer`; you start it yourself. Extract CI's env rather
than typing it, because two 27-minute runs were wasted on a hand-typed value:

```bash
sed -n '/name: Studio · Playwright/,/steps:/p' .github/workflows/ci.yml \
  | grep -E "^      [A-Z_]+:" > /tmp/studio-env.raw     # then export them
```

Two facts that will otherwise cost you a run each:

- `PLATFORM_OPERATORS` is **`email:role`**. A bare address is REFUSED, never
  defaulted — a role default would make everybody an administrator.
- `AWS_ACCOUNT_ID` and `AWS_PARTITION` must be set or the console refuses to
  boot. That is deliberate: it will not invent an estate. `FleetMisconfigured`
  in `/tmp/studio.log` means the env was not sourced.

---

## 8. PRODUCTION ACCESS, AND WHAT IS STILL OPEN ON IT

Access to the deployment engine is **one person**:
`satvik@Tenurework.com:platform-super-admin`.

Auth is **Cognito** (`STUDIO_AUTH_MODE=cognito`), not the old shared secret.

An audit on 2026-08-13 found the migration had **reissued the shared secret as a
permanent Cognito password** — `password` rather than `temporary_password`, with
`message_action = "SUPPRESS"` so no reset was ever forced, `mfa_configuration`
`OPTIONAL`, and the same value still shipped to the task and printed by an
output. Anyone holding it plus an allowlisted address was platform-super-admin.
Fixed in `2b7274c`: `temporary_password`, MFA `ON`, secret off the ECS task.

**Still open, and it needs the account owner:**

- The **first sign-in after the next deploy** forces a new password and TOTP
  enrolment. There is a **seven-day clock** (`temporary_password_validity_days`).
- The old value should be **rotated** afterwards — it is still in Secrets Manager
  and in the repository secret.

---

## 9. OPEN DEFECTS, PRECISE AND VERIFIED

| Where | What |
|---|---|
| `apps/system-studio/src/app/page.tsx`, `tenants/page.tsx`, `tenants/new/page.tsx`, `tenants/actions.ts` | Read the UNFILTERED `TENANT_BINDINGS`, so three fixtures render as customer organisations. `CUSTOMER_TENANT_BINDINGS` exists; switch them. The guard `tests/architecture/no-fixture-tenants-on-operator-surfaces.test.mjs` is written and **held back on the WIP branch** until they are — land them together. |
| REVIEW-FINDINGS P0 #4 | Effective-permission SQL grants authority to SUSPENDED/LEFT members and disabled principals. **IER's**, and unstarted. |
| REVIEW-FINDINGS P1 #15 | The session carries a membership list — an authorization claim in a token. `getUserContext` already loads memberships and is `React.cache()`d, so `sub` alone suffices. |
| REVIEW-FINDINGS P2 #19 | `finance.roleNamePatterns` is a tenant-writable regex deciding `canManageFinance`, `sensitivity: "standard"`, no `requiresCapability`, guard regex excludes nothing. **CFG's.** Take substrings, not regex. |
| TTES-020-004 | FAIL. `visual-baselines.spec.ts` withdrawn — the machinery is right, the PNGs have never existed. A `workflow_dispatch` workflow generates them; a human commits them. |
| `apps/system-studio/.next-audit110` | An audit artefact directory sitting in `tsconfig.json`'s `include`. Probably wants deleting. |

**`docs/architecture/REVIEW-FINDINGS.md` overrides `PLATFORM-ARCHITECTURE.md`
wherever they disagree.** It is 73 lines and names 11 P0 defects. Read it.

---

## 10. HOW TO GO FAST WITHOUT GOING BACKWARDS

The operator's standing instruction is aggressive parallelism. The way to honour
it that has actually worked:

- **Fan out by FILE, not by feature.** One agent per AWS service, one per route,
  each owning a named file set stated in its prompt. 18 concurrent agents ran
  clean this way; file-ownership isolation by *package* previously made every
  requirement end blocked at the `apps/web` boundary.
- **Sequence the foundation.** A page cannot adopt a token layer that does not
  exist. Ground phase first (tokens, IA, capability registry), then the fan-out.
- **Check live, do not wait for the completion notification.** Poll the workflow
  journal and re-run `studio:type-check` while it runs. Expect transient errors —
  twice, an error was fixed by the agent that owned the file before intervention
  was needed. Fix what is stable, leave what is mid-write.
- **Push every green increment.** Do not save up. And after any bulk change:
  `git add -A && git diff --cached --name-status --diff-filter=D` — empty is the
  expected result. `packages/finops` was once deleted by a `git add -A` nobody
  inspected.

---

## 11. THE STANDARD — every claim

- **Real code reached by a real production caller.** Name the caller or return
  blocked. A type nothing calls is dead code; dead code with a comment claiming
  otherwise is worse than nothing.
- **Mutation-prove every test.** Apply, run, confirm it FAILS, restore, confirm
  it passes. Report the mutation and both results.
- **A stand-in that returns a canned value proves nothing.** For AWS that means
  it must distinguish AccessDenied, a throttle, an empty-but-successful list and
  a populated one — and the surface must say something different for each.
- **If a comment or evidence string is false, fix the CLAIM, not the test.**
- **Do not mark PASS what is not true.** An honest FAIL outranks a false PASS,
  and `BLOCKED_EXTERNAL` must name the commands that would unblock it.
- **Report faithfully.** If tests fail, say so with the output. If a step was
  skipped, say that.
