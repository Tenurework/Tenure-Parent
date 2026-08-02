# The autonomous loop

How work on the 552-item programme proceeds without being asked each time.

This file is the durable part. The scheduler that fires a tick lives in a
Claude session and dies with it; the rules, the scripts and the ledger do not.
A new session reads this, runs `tools/loop/next-batch.mjs`, and continues —
which is the point. **Nothing here depends on remembering anything.**

---

## The cadence

**Ten items per push. One item at a time inside the batch.**

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

**Write the ledger entry BEFORE the final `git add`.** The gate regenerates
first, and `platform-truth.json` includes the ledger's item counts — so
appending an entry after staging produces a real, material diff (not the
tolerated commit-line-only one) and the gate correctly fails. The order that
works:

```bash
cat entry.md >> docs/implementation/global-engine-execution-ledger.md
git add -A
node tools/loop/batch-gate.mjs > /tmp/gate.out || { tail -20 /tmp/gate.out; exit 1; }
git add -A && git commit -F message.txt && git push origin main
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

```
docs/implementation/Tenure_Claude_Code_Unified_Global_Engine_Master_Prompt_v2.0.md   GE-*   (658)
docs/architecture/Tenure_Global_ERP_Implementation_Extension_v1.0.md                 EXT-*  (186)
docs/architecture/Tenure_Global_System_Architecture_Bible_v1.0.md                    target design
```

**844 items in one queue, not two.** v2.0 requires a single traceable
verification system and forbids duplicating requirements into divergent
documents; a second queue would be exactly that, and it would be the one nobody
ran. The ledger records `GE-*` and `EXT-*` decisions in the same file for the
same reason.

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
