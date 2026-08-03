# The autonomous loop

How work on the 1219-item programme proceeds without being asked each time.

This file is the durable part. The scheduler that fires a tick lives in a
Claude session and dies with it; the rules, the scripts and the ledger do not.
A new session reads this, runs `tools/loop/next-batch.mjs`, and continues —
which is the point. **Nothing here depends on remembering anything.**

---

## The cadence

**Ten items per push. One item at a time inside the batch.**

**Re-read the authority every 30 minutes** — the ledgers, then the execution
prompts, then the Architecture Bible. Not hourly: this was tightened on
2026-08-02 after two new binding prompts landed mid-session and the queue kept
serving the old one. Thirty minutes is short enough that a document uploaded
while a batch is in flight is picked up inside that batch. A tick that has not
re-read in 30 minutes re-reads before it does anything else.


Those are different cadences and conflating them is the mistake this section
exists to prevent. Batching the *push* trades CI cycles for later discovery of
a CI-only failure. Batching the *verification* would mean ten items of work and
one red build with no idea which of the ten broke it.

So, per item:

1. Read the item in the execution prompt, and its target design in the
   architecture bible. Not the prompt alone — the prompt says what, the bible
   says what it should look like.
2. Implement it. Real code, wired into something that runs. No mocks, no
   stubs, nothing illustrative.
3. Write tests that assert the *decisions*, not the shape.
4. **Prove the tests by mutation.** Break the guarded behaviour, confirm the
   test fails, restore, confirm it passes. A test nobody has watched fail is a
   test nobody has any reason to believe.
5. Record it in the ledger with evidence, including the honest limits.

Then, per batch, before pushing:

6. `node tools/loop/batch-gate.mjs` — everything CI runs, in CI's order.
7. The e2e suites, by hand, on a **freshly recreated database**:
   `apps/web` (Playwright) and `apps/system-studio` (Playwright, with a local
   DynamoDB). These are the checks most sensitive to stale state, which is why
   they are not in the gate script — a suite run against a database the last
   run mutated is a suite that passes for the wrong reason.
8. Terraform `fmt -check -recursive` and `validate` per stack, via Docker.
9. Push. Wait for green. **A red build is the next tick's only work.**

---

## What counts as done

An item is `PASS` when it is integrated into something that runs, its tests
pass, its mutations were caught, and the evidence is in the ledger. A schema, an
interface, a mock, a component nobody renders, or a test nobody ran does not
qualify — that rule is §4 of the execution prompt and it is the one that keeps
the ledger worth reading.

An item is `BLOCKED_EXTERNAL` when it genuinely cannot proceed without a human
or an AWS resource that does not exist. Record it **with the exact commands the
operator would run**, then keep working on everything else. Blocked is a
decision, not a pause — `next-batch.mjs` treats it as decided so the loop does
not spin on work waiting for someone.

There is no `PARTIAL`. Unfinished is unchecked.

---

## Rules that do not bend

**One workflow at a time.** If anything is not green, fixing it is the whole
tick. Not "after this item" — before.

**Push to `main` in this repository only.** Never to `satvikOS/Tenure`; a push
to its main rolls production for a live pilot carrying real student data. Open
a pull request there instead.

**Never weaken a guard to make a build pass.** Three times now a guard has fired
correctly and the fix was to change the code, not the guard — the disarm rules
caught an `aws` CLI call, `cell-independence` caught the cell importing the
engine's control plane, and `no-personal-data` caught a plausible address in a
fixture. A guard with an exception in it is a guard that will be worked around.

**Generate before verifying, never after.** `npm run generate` writes three
artifacts CI compares against their sources. Regenerating after the checks
produces a file that was current when written and stale when pushed. This has
happened twice; `batch-gate.mjs` runs it first so the order is a property of the
script rather than of anyone's memory.

**State honest limits in the ledger entry.** Every item has them. An entry that
claims more than was built is worse than no entry, because the next reader
builds on it.

**Say when a mutation misses.** A mutation that lands in the wrong place, or
whose marker has drifted, proves nothing — and looks identical to a guard that
works. Record it and re-anchor.

Two further things a mutation can mean, and both have happened:

- **The test was weak, not the code.** Three items running, a mutation found a
  defective assertion rather than a defective implementation — a rank test that
  never exercised rank, a four-eyes check whose lint copy nothing asserted, a
  simulation test that never reached the `catch`. The fix is the test.
- **The mutant is equivalent.** In GE-031-007, recomputing `rollbackTo` as
  `revision - 1` is provably the same value as the plan's, given the stale-plan
  invariant. Unkillable because the code is the same function. Say so; do not
  invent an assertion to make a number look better.

**Never pipe a gate into `tail`, and never follow it with `;`.** A pipeline's
exit status is the LAST command's, so `node tools/loop/batch-gate.mjs | tail -2`
always succeeds and `&& git push` runs regardless of the verdict. Writing
`gate; echo $?; git commit` has the same effect for the same reason — `;` does
not care what came before it. Between them these have masked a failing gate
three times and a failing `terraform fmt` once.

**The gate does not run the Playwright suites. A change under `apps/*/src/app`
is not verified until you have run them.** `batch-gate.mjs` runs type-check,
lint, unit tests, the platform guards and both builds — it does not start a
server or a browser, deliberately, because those need a database and a fresh one
per run. So a UI change can pass the gate and red CI, which is exactly what
happened on 2026-08-02: the platform page's badge changed from `ledger.done` to
`programme.decided`, the gate passed all eight steps, and `platform.spec.ts`
failed in CI on the number it asserts. Treat "it's only wiring" as the tell — the
commit that feels too small to test is the one that skips the suite.

**Run the Studio suite against a server you started from the current build.**
`next start` fails with `EADDRINUSE` if an instance from an earlier session is
still on :3100, and the failure scrolls past in a backgrounded log. Playwright
then tests the *old* build and reports failures that were fixed an hour ago. Kill
the port first, and check the log says `Ready` before trusting a run:

**`pkill -f "next start"` does not work here.** Git Bash's `pkill` does not match
the Windows process, so it exits silently having killed nothing, the new server
dies with `EADDRINUSE`, and Playwright tests the old build. That is the same
stale-build trap as above wearing a different hat, and it cost a second hour the
day after this warning was written. Kill by **port**, from PowerShell, and check
the log says `Ready`:

```powershell
Get-NetTCPConnection -LocalPort 3100 -State Listen -ErrorAction SilentlyContinue |
  Select-Object -Unique OwningProcess |
  ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }
```

```bash
node tools/dev/reset-registry-table.mjs      # neither suite is idempotent
rm -rf apps/system-studio/.next              # a stale .next 404s new routes
npm run studio:build
set -a; . /tmp/studio-env.sh; set +a         # the server needs these EXPORTED
npm run start --workspace apps/system-studio > /tmp/studio.log 2>&1 &
until curl -sf http://localhost:3100/signin >/dev/null; do sleep 1; done
grep -q Ready /tmp/studio.log || { tail -20 /tmp/studio.log; exit 1; }
cd apps/system-studio && ../../node_modules/.bin/playwright test --config=playwright.config.ts
```

A new route returning **404 while the build output lists it** means the server is
not the build you just made. It is never a routing bug; check the log first.

**Do not run `npm run test:platform` while the gate is running.** One guard
writes a probe file into the source tree and deletes it; two concurrent runs
race on it and the second fails with `ENOENT ... .content-probe.ts`. It looks
like a real guard failure and is not — re-run it alone before believing it. This
cost two cycles on 2026-08-02.

**A new package under `packages/` needs `npm install --package-lock-only`.**
Adding a workspace without regenerating `package-lock.json` passes every local
check — the workspace symlink already exists in `node_modules`, so type-check,
jest and both builds are happy — and then `npm ci` fails inside the Docker build
because the lockfile does not list the workspace. `batch-gate.mjs` cannot catch
it: it runs `npm run build`, not `npm ci` in a clean container. This is the
second failure mode that only appears past the gate, after the Playwright one.

Verify it the way the deploy does:

```bash
docker run --rm -v "//c/Users/satvi/Tenure-Parent://w" -w //w node:22-alpine   sh -c "npm ci --ignore-scripts --dry-run"
```

**A narrowing guard is not an assertion.** TypeScript needs
`if (outcome.valid) return` to narrow a discriminated union, and it silently
turns the test that follows into nothing:

```ts
const outcome = validate(...)
if (outcome.valid) return          // regression -> early return -> test passes
expect(outcome.reason).toBe("ISSUER_MISMATCH")
```

Assert the premise first — `expect(outcome.valid).toBe(false)` — then narrow.
This was found by a mutation run on GE-042-003 that caught only 10 of 17: seven
survivors had one cause and no other. A sweep found 54 such guards across the
identity package and 21 were missing their assertion.

The tell is a mutation surviving that obviously should not. When several
survive at once, look for one shared cause in the tests before concluding the
code is under-specified.

**Never type a control character into source. Write the escape, and fix it at
the byte level.** A NUL or a newline typed into a string literal — a map-key
separator, a header-splitting test fixture — lands as a raw byte. The code
works, every test passes, and `git diff`, `grep` and code review all stop
working on the file because git treats it as binary. `no-binary-source` catches
it at the gate, which is late.

This has now happened **five times** here: `integrity.ts`, `rejections.ts`,
`keying.ts`, a ledger entry describing the `keying.ts` fix, and
`authorization-request.test.ts`. Two of those were mutation runs failing to
*apply*, which looks exactly like a guard that works.

The fix must be byte-level. A text-mode read/modify/write round trip
re-encodes the escape back into a raw byte and reports success — it did that
twice before I stopped trying:

```python
d = open(path, "rb").read()
BS = bytes([92])
for b in list(range(0, 9)) + [11, 12] + list(range(14, 32)) + [127]:
    d = d.replace(bytes([b]), BS + ("u%04X" % b).encode("ascii"))
open(path, "wb").write(d)
```

**Backslashes do not survive bash → python argv.** A mutation anchored on
`/^\/[/\]/` will report ANCHOR MISSING however it is quoted. Locate the
edit by index (`s.index(...)`, `s.rindex(...)`) and splice, or build the
replacement from `chr(92)`. An anchor that never matches reports the mutation
as surviving, which is indistinguishable from a test that does not catch it.

**Never write a commit message with Python's `open("/tmp/...")`.** Git Bash's
`/tmp` and Windows' `C:	mp` are different directories, and Python resolves the
POSIX-looking path to the Windows one. The script reports success, `git commit -F
/tmp/msg.txt` reads whatever the *last* heredoc left there, and the commit lands
carrying the previous commit's message over completely different work. That
happened on 2026-08-02: `2745f2e` contains the FinOps Center and is labelled
GE-GATE-3. It was not amended, because rewriting pushed history is on the
must-not list — the correction is a follow-up commit and this paragraph.

Write the message with a heredoc, or to an absolute Windows path, and `head -3`
the file before committing.

**Write the ledger entry BEFORE the final `git add`.** The gate regenerates
first, and `platform-truth.json` includes the ledger's item counts — so
appending an entry after staging produces a real, material diff (not the
tolerated commit-line-only one) and the gate correctly fails. The order that
works:

The `generate` between them is not optional, and leaving it out is what has
actually failed: the gate runs `npm run generate` as its FIRST step, so a
regeneration triggered by the ledger append lands unstaged and the gate rejects
its own output. Generate before staging and the gate's own run is a no-op.

The entry goes in the ledger belonging to the item's prefix — `GE-*` and `EXT-*`
in the global engine ledger, `STUDIO-*` and `SIMON-*` in their own. Putting one
in the wrong file does not fail anything loudly: `next-batch.mjs` reads all
three into one map, so the item correctly drops out of the queue and the only
casualty is that the record is filed where nobody looking for it will look.

```bash
cat entry.md >> docs/implementation/global-engine-execution-ledger.md
npm run generate                 # the ledger append changed the item counts
git add -A
node tools/loop/batch-gate.mjs > /tmp/gate.out || { tail -20 /tmp/gate.out; exit 1; }
git commit -F message.txt && git push origin main
```

---

## The scripts

```
node tools/loop/next-batch.mjs           # what to do next, and how much is left
node tools/loop/next-batch.mjs --json    # same, machine-readable
node tools/loop/batch-gate.mjs           # everything CI runs; exit 1 = do not push
```

`next-batch.mjs` derives the queue from the requirement documents and the
ledger, so the answer is a property of the repository. It knows about the two
shapes the ledger uses — a single item and a `GE-010-002 … 007` range — and it
treats `PASS`, `BLOCKED_EXTERNAL` and `NOT_APPLICABLE` as decided.

### The authority, as of 2026-08-02

Four binding execution prompts, one target design.

```
docs/implementation/Tenure_Claude_Code_Unified_Global_Engine_Master_Prompt_v2.0.md     GE-*      (709)
docs/architecture/Tenure_Global_ERP_Implementation_Extension_v1.0.md                   EXT-*     (186)
docs/implementation/Tenure_System_Studio_AWS_Authoritative_Control_Plane_..._v1.0.md   STUDIO-*  (167)
docs/implementation/Tenure_Simon_OSE_Tenant_Absorption_..._v1.0.md                     SIMON-*   (157)
docs/architecture/Tenure_Global_System_Architecture_Bible_v1.0.md                      target design
```

**1219 items in one queue, from four documents, recorded in three ledgers.**

The queue is single because v2.0 requires one traceable verification system and
a second queue is the one nobody runs. The ledgers are plural because the two
bibles added on 2026-08-02 each name their own file in an imperative sentence
— "Create `docs/implementation/simon-ose-absorption-execution-ledger.md` and
copy every `SIMON-*` item into it" — and tidying three explicit instructions
into one file would be overriding them for neatness. `next-batch.mjs` reads all
three into one map, so the split record costs nothing.

**A full batch draws from every document, in runs of three.** Straight document
order would leave both new bibles untouched for months behind 700 GE items,
while SIMON carries a Fall 2026 pilot date and STUDIO is the contract the Studio
is being built against. Runs of three rather than strict round-robin because
consecutive items are usually one piece of work.

**Gates are items.** All 80 `*-GATE-*` ids are real checkpoints carrying their
own evidence, and they appear in document order after the work they gate — so
reaching one in the queue is exactly when it should be evaluated. They were
silently excluded until 2026-08-02 by a filter written to drop section heads
that do not exist; three had already been decided while the queue said they were
not items at all, which is how `decided` came to exceed `total - remaining`.
`tests/architecture/work-queue.test.mjs` now asserts that arithmetic closes.

**Precedence, when documents disagree.** Both new bibles state it and they
agree: law and protected-environment controls, then the Architecture Bible and
accepted ADRs, then the binding extension, then the prompt in hand, then the
existing implementation. Preserve the stricter security, isolation, audit,
reversibility and data-ownership invariant. Stop only the conflicting scope,
write an ADR quoting both exact clauses, and carry on with everything else.
**Never silently weaken the Bible to accommodate current code.**

**v2.0 supersedes the v1.1 execution prompt and invalidated nothing.** Every one
of v1.1's 534 GE ids survives into v2.0's 658 — verified by set difference, not
assumed — so the decisions already in the ledger still stand. 141 GE items are
new. v1.1 stays in the repository as the record of what the first sixty
decisions were made against.

**Where the Bible and the extension disagree**, v2.0 §"Mandatory document
ingestion" governs: stop only the conflicting scope, write an ADR quoting both
exact clauses, keep the stricter invariant, and carry on with everything else.

`batch-gate.mjs` refuses on the first failure and reports what the step
protects, so the failure is actionable without opening the script. It also fails
when a generated artifact changed and was not staged, with one narrow exception:
`platform-truth.json` records the HEAD commit, so a diff that is *only* that
line is not drift. Any other change in the same file still is.

---

## Checks an operator runs, because CI cannot

```bash
# The repository default workflow permission is read-only, and workflows
# cannot approve pull requests. Needs `administration` scope, which
# GITHUB_TOKEN cannot be granted — see the note in the tool.
GH_TOKEN=$(gh auth token) node tools/verify-workflow-permissions.mjs
```

---

## Lessons that cost a red build

**Run the e2e locally when a response shape changes.** GE-042-006 shipped a
`/api/me` field that was wrong for most users and went red on the first push.
The gate does not run Playwright. The environment CI uses is in `ci.yml` under
the `E2E · Playwright` job — copy the whole `env:` block, including
`TENANCY_ENFORCE=true`, or the local run is a weaker test than CI.

Use a **separate database**: `prisma migrate reset` is refused by a safety
guard, and the e2e suite is not idempotent.

```bash
docker exec tenure-pg psql -U tenure -d postgres   -c "DROP DATABASE IF EXISTS tenure_e2e" -c "CREATE DATABASE tenure_e2e OWNER tenure"
# then DATABASE_URL=...tenure_e2e, prisma migrate deploy, seed.mjs, npm run build
```

`next start` serves whatever is in `.next`. A code change with no rebuild
produces a local pass that means nothing.

**A fixture built from the entity the code reads will not find the entity it
forgot.** `access-state.itest.ts` created `InstitutionMembership` rows and
tested five states of a shape most users do not have — club members hold a
`RoleAssignment` and no membership at all. The e2e caught it because it signs in
as a real seeded person rather than one the test invented. When a query decides
who somebody is, check the fixture covers every way of *being* that somebody.

**`gh run watch <id> | tail` reports `tail`'s exit code.** `$?` after a pipe is
the last command in it. Read the status from `gh run list` instead.

**Confirm every mutation CAUGHT with a second run.** A tenant-switch mutation
reported CAUGHT on Windows and provably survives in isolation; that survivor was
a real defect (`rotateSession` accepted a `reason` and dropped it). One red run
is not evidence. This is the second harness in this repository to misreport.

**A Prisma query is a lazy thenable.** `runInTenantScope(scope, () => db.x.findMany())`
lost the scope until GE-042-006, because `.then` was called by the caller's
`await` after the context closed. Fixed in `context.ts`; the shape is safe now,
and the reason it was ever unsafe is worth remembering when writing anything
else that wraps a callback in `AsyncLocalStorage`.

**The NUL-byte guard only scans tracked files, so it fires after `git add`.**
`test:platform` can report 160/160 on a file that contains raw NUL bytes,
because `git ls-files` has never heard of it. A run before staging is not a
clean bill of health for new files — the gate is where it shows up, which is
late but not too late. When writing a fixture containing spaces or unusual
characters, check it at byte level immediately:

```bash
python -c "import io,sys;raw=io.open(sys.argv[1],'rb').read();print(raw.count(bytes([0])))" path
```

The recurring cause is a literal `" . . "` or similar in a Write payload
arriving as NULs. Fix at byte level; a text-mode round-trip re-encodes.

**Assert the mutation is actually in the file before trusting the result.** A
mutation harness reported SURVIVED for a change that provably fails when applied
by hand — the anchor matched, the replacement was computed, and what reached
disk was not what the run measured. Read the file back and confirm the mutated
text is present and the original is gone; a harness that only checks its anchor
is measuring its own bookkeeping. Fourth misreport from a mutation harness in
this repository.

**Guards that list untracked files must tolerate ENOENT.** `test:platform` runs
them in parallel and one writes a probe into the source tree. A guard that
crashes on a vanished file goes red for a reason unrelated to what it checks —
`forbidden-clients` did so in roughly half of all runs and never once alone.

**An intermittent e2e failure is a diagnosis, not a verdict.** `reimbursement`
went red on a click that timed out reading `$1,400.00` from a budget line. The
failure was four steps downstream of the defect. Take the trace before touching
anything: `gh api repos/OWNER/REPO/actions/runs/<id>/artifacts`, download
`playwright-traces`, and read `error-context.md` — it is a snapshot of the page
at the moment of failure and it answers "what did the user actually see". Here
it said the ledger read `$1,350.00`, and the retry's said `$1,450.00` — proving
both attempts had posted, so the write was never the problem. The `.trace` file
inside the zip is JSONL: every action with its start and end time. It showed the
first 2.5 seconds normal and 42.7 seconds spent waiting on one locator.

**`getByText("X")` is a case-insensitive SUBSTRING match.** That is what broke
the run above. The test asserted `getByText("Approved")` right after submitting
the final approval, and the confirmation dialog it had just submitted read "The
request is approved for good" — so the assertion was satisfied by the dialog's
own copy, before the form was submitted at all. The test never waited for the
approval, navigated away mid-action, and read the page before the transaction
committed. Locally the write won the race; on a loaded runner it lost. Prove
what an assertion matches rather than reasoning about it: open the page to the
state *before* the action and `console.log(await locator.count())`. It should be
zero. `tests/architecture/status-assertions-are-exact.test.mjs` now fails any
unscoped, non-exact assertion naming a status label.

**A page rendered once will not correct itself.** Nothing on these pages polls,
so a stale read is permanent for that navigation and Playwright waits out the
whole timeout on a number that already changed in the database. An assertion
that proves a write landed must be one the pre-write page cannot satisfy —
otherwise the test's own navigation is the race.

**`npm run start` serves the last build, not your working tree.** Playwright's
`webServer` runs `next start`, which does not compile. Two consecutive local e2e
runs reproduced a failure I had already fixed, because the fix was in TypeScript
and the server was serving `.next` from a build made before it. Run
`npm run build --workspace apps/web` first, or the run is a test of whatever was
last compiled. CI is safe here — it builds — which is why this only ever wastes
local time, and it wastes a lot of it.

**Run the e2e suite before pushing anything that changes a shared package.**
`batch-gate` runs type-check, unit, guards and both builds; it does not run e2e.
GE-051-001 passed all of that and broke the admin console, because the only
caller of the authorization engine in `apps/web` had no unit test at all. The
gate is not a substitute for the suite when the change is in `packages/`.

**A string that three places agree on is not a contract; it is a coincidence.**
The admin nav link needed one permission and it was spelled three ways in three
files: the capability the layout computed, the `requiresCapability` on the nav
entry, and the module manifest's `permissions` list. All three matched each
other and nothing else, so every one of them looked right in isolation. When a
change makes one authoritative, expect the other two, and go and find them —
`grep` for the old string across the whole repo, not just the file you edited.

**A flake that accuses the wrong test is the expensive kind.** `test:platform`
went red in roughly one run in four saying `docs/architecture/ownership.md is
stale` — a file that was correct. The cause was three tests away: a guard
proving its own grep worked by writing a probe file into the source tree,
grepping for it, and deleting it. Sound in isolation, and for the few hundred
milliseconds it existed, every guard that walks the tree was looking at a
repository that does not match the one committed. Before regenerating whatever
an intermittent failure names, ask what else was running.

**A pipeline's exit code is `tail`'s.** `node tools/loop/batch-gate.mjs 2>&1 |
tail -3 && git commit` commits whether or not the gate passed, because `tail`
succeeded. The same shape already burned a `gh run watch | tail`. Redirect to a
file and check `$?`, or put the command last.


**`subprocess.run(list, shell=True)` on Windows joins the arguments unquoted.**
A mutation batch reported 11/11 caught against a baseline that was red for the
whole run: `--testPathPattern "a|b"` became a shell pipe and every invocation
returned 255. Pass one quoted string, and never trust a batch whose baseline
line does not say `False` — that line exists because this is not detectable any
other way.

**A seeded database cannot test a backfill.** `seed.mjs` runs after
`migrate deploy` and upserts the same rows, so a test asserting the column is
right is measuring the seed. Dropping a migration's backfill entirely survived
six assertions that looked like they covered it. Replay the migration's own
statements against rows put back to the state it started from — and put them
back *exactly*: emptying to NULL and scrambling to some other value look
equivalent, and a `WHERE ... IS NULL` catch-all tells them apart.

**Regenerate before running the guards after adding a source file.** This is the
rest of the answer to the flake above, and it took three ticks. The residual
`test:platform` failure was `ownership-map --check` on a new file under
`apps/web/src`. It read as unexplained because the hypothesis test added a file
under `tests/`, which the ownership map does not cover — so a correct hypothesis
came back clean and the real cause survived two more ticks. Test a hypothesis
with the *same* input that produced the failure.

---

## What is session-scoped, and what is not

| Durable — survives any session | Session-scoped — dies with the REPL |
|---|---|
| These rules | The cron heartbeat |
| `tools/loop/*.mjs` | The CI monitor |
| The ledger and its evidence | Anything in memory |
| Every guard in `tests/security/` | |

A new session picks up by reading this file and running `next-batch.mjs`. If the
scheduler is gone, the work is not — that is the whole reason the queue is
derived from documents rather than held anywhere.
