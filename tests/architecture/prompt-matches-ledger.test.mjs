import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"

import { ledgerState, reconcile } from "../../tools/reconcile-execution-checkboxes.mjs"

/**
 * The execution prompts and the ledger must record the same facts.
 *
 * They drifted to seventy-seven disagreements before anybody looked: seventy-six
 * items recorded PASS in the ledger and unticked in the prompt, and one ticked
 * while recorded BLOCKED_EXTERNAL. `next-batch.mjs` reads the ledger, so no work
 * was repeated — the damage was to anybody reading the prompt, who saw
 * seventy-six finished items as outstanding, and to any gate over those
 * children, which could not be assessed from the prompt at all.
 *
 * Nobody notices a checkbox that was not ticked. That is the whole reason this
 * is generated rather than maintained.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, "../..")

test("every execution prompt agrees with the ledger", () => {
  // Runs the tool's own `--check`, so the guard and the generator cannot
  // disagree about what agreement means.
  execFileSync("node", ["tools/reconcile-execution-checkboxes.mjs", "--check"], {
    cwd: ROOT,
    stdio: "pipe",
  })
})

test("a tick means finished, not merely decided", () => {
  // `next-batch.mjs` treats BLOCKED_EXTERNAL as decided — it must, or the loop
  // spins on work waiting for a human. A checkbox is a different claim, and
  // ticking a blocked item would hide the one thing an operator needs to see.
  const state = ledgerState()
  const blocked = [...state.entries()].filter(([, status]) => status === "BLOCKED_EXTERNAL")

  assert.ok(blocked.length > 0, "no BLOCKED_EXTERNAL items found — the state reader is not working")

  const prompt = fs.readFileSync(
    path.join(ROOT, "docs/implementation/Tenure_Claude_Code_Global_Engine_Execution_Prompt_v1.0.md"),
    "utf8",
  )

  const wronglyTicked = blocked
    .map(([id]) => id)
    .filter((id) => new RegExp(`^- \\[x\\] ${id}\\b`, "m").test(prompt))

  assert.deepEqual(
    wronglyTicked,
    [],
    `these are BLOCKED_EXTERNAL and ticked as finished:\n  ${wronglyTicked.join("\n  ")}`,
  )
})

test("the reconciler moves checkboxes in both directions", () => {
  // A generator that only ever ticks would leave a wrongly-ticked item ticked,
  // which is exactly the one disagreement of the seventy-seven that mattered
  // most: GE-042-007 was ticked and then recorded BLOCKED_EXTERNAL.
  const state = new Map([
    ["GE-999-001", "PASS"],
    ["GE-999-002", "BLOCKED_EXTERNAL"],
  ])

  const before = ["- [ ] GE-999-001 — done but unticked.", "- [x] GE-999-002 — blocked but ticked."].join("\n")
  const after = reconcile(before, state)

  assert.match(after, /^- \[x\] GE-999-001/m, "a PASS item was not ticked")
  assert.match(after, /^- \[ \] GE-999-002/m, "a BLOCKED_EXTERNAL item was not unticked")
})

test("an item the ledger has never mentioned is left alone", () => {
  // This syncs what is recorded. It does not invent a decision, and an item with
  // no ledger entry is one nobody has decided.
  const untouched = "- [ ] GE-999-003 — never recorded anywhere."
  assert.equal(reconcile(untouched, new Map()), untouched)

  const ticked = "- [x] GE-999-004 — ticked by hand, never recorded."
  assert.equal(reconcile(ticked, new Map()), ticked)
})

test("the state reader finds what the ledger records", () => {
  // Asserted because the failure mode is silence: a reader that returned an
  // empty map would report every prompt as agreeing with it.
  const state = ledgerState()

  assert.ok(state.size > 100, `expected the ledgers to record many items, found ${state.size}`)
  assert.equal(state.get("GE-044-006"), "PASS")
  assert.equal(state.get("GE-044-001"), "BLOCKED_EXTERNAL")
})

test("the reconciler reads the ledger's Status line, not just its checkbox", () => {
  // The ledger's own checkbox is a fallback. GE-042-007 is `- [x]` there with
  // `Status: **BLOCKED_EXTERNAL**` below it, and reading only the checkbox would
  // have propagated the tick straight back into the prompt.
  assert.equal(ledgerState().get("GE-042-007"), "BLOCKED_EXTERNAL")
})

test("--check actually fails on a stale prompt", () => {
  // The assertion above only ever sees the tool succeed on a clean tree, which
  // is the case that proves nothing: a mutation removing the non-zero exit
  // survived it. This points `--check` at a deliberately staled copy.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "prompt-ledger-"))
  const copy = path.join(dir, "prompt.md")

  // One item the ledger records as PASS, written unticked.
  const passing = [...ledgerState().entries()].find(([, status]) => status === "PASS")
  assert.ok(passing, "no PASS item to build a stale prompt from")
  fs.writeFileSync(copy, `- [ ] ${passing[0]} — recorded as done, unticked here.\n`)

  assert.throws(
    () =>
      execFileSync("node", ["tools/reconcile-execution-checkboxes.mjs", "--check", "--prompt", copy], {
        cwd: ROOT,
        stdio: "pipe",
      }),
    /Command failed/,
    "--check accepted a prompt that disagrees with the ledger",
  )
})

test("--check accepts a prompt that agrees, so the failure above is not blanket", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "prompt-ledger-ok-"))
  const copy = path.join(dir, "prompt.md")

  const passing = [...ledgerState().entries()].find(([, status]) => status === "PASS")
  fs.writeFileSync(copy, `- [x] ${passing[0]} — recorded as done, ticked here.\n`)

  execFileSync("node", ["tools/reconcile-execution-checkboxes.mjs", "--check", "--prompt", copy], {
    cwd: ROOT,
    stdio: "pipe",
  })
})
