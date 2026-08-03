#!/usr/bin/env node
/**
 * The execution prompts' checkboxes, derived from the ledger.
 *
 *   node tools/reconcile-execution-checkboxes.mjs           # write
 *   node tools/reconcile-execution-checkboxes.mjs --check   # fail if they disagree
 *
 * Two records of one fact drift, and these had: 76 items were PASS in the ledger
 * and unticked in the prompt, and one was ticked while recorded
 * BLOCKED_EXTERNAL. `next-batch.mjs` reads the ledger, so no work was repeated —
 * but anybody reading the prompt saw seventy-six finished items as outstanding,
 * and a gate over those children could not be assessed from it at all.
 *
 * **The ledger is the source.** It carries the evidence, the mutation counts and
 * the honest limits; the prompt is an index into it. So this generates one from
 * the other rather than asking a person to keep them in step, which is the thing
 * that demonstrably does not work.
 *
 * ## A tick means done, not decided
 *
 * `next-batch.mjs` treats `BLOCKED_EXTERNAL` as *decided* — it must, or the loop
 * spins on work waiting for a human. A checkbox is a different claim: it says
 * the item is finished. A blocked item is not finished, it is parked, and
 * ticking it would hide the one thing an operator needs to see. So the rule is
 * `[x]` exactly when the ledger says PASS or NOT_APPLICABLE.
 */

import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, "..")

const LEDGERS = [
  "docs/implementation/global-engine-execution-ledger.md",
  "docs/implementation/system-studio-aws-control-plane-execution-ledger.md",
  "docs/implementation/simon-ose-absorption-execution-ledger.md",
]

const PROMPTS = [
  "docs/implementation/Tenure_Claude_Code_Global_Engine_Execution_Prompt_v1.0.md",
  "docs/implementation/Tenure_Claude_Code_Unified_Global_Engine_Master_Prompt_v2.0.md",
  "docs/implementation/Tenure_Claude_Code_System_Studio_AWS_Control_Plane_Execution_Prompt_v1.0.md",
  "docs/implementation/Tenure_Simon_OSE_Absorption_Execution_Prompt_v1.0.md",
]

const ITEM = /((?:GE|EXT|STUDIO|SIMON)-[\w-]+)/
/** Statuses that mean the item is finished, as opposed to merely decided. */
const DONE = new Set(["PASS", "NOT_APPLICABLE"])

function read(file) {
  const full = path.isAbsolute(file) ? file : path.join(ROOT, file)
  return fs.existsSync(full) ? fs.readFileSync(full, "utf8") : null
}

/** Every item the ledgers record, with the status they record for it. */
export function ledgerState() {
  const state = new Map()

  for (const ledger of LEDGERS) {
    const text = read(ledger)
    if (text === null) continue
    const lines = text.split("\n")

    for (let i = 0; i < lines.length; i++) {
      const entry = new RegExp(`^- \\[([ x])\\]\\s+\\*\\*${ITEM.source}`).exec(lines[i])
      if (!entry) continue

      // The checkbox is the fallback; an explicit `Status:` below it wins,
      // which is where BLOCKED_EXTERNAL lives.
      let status = entry[1] === "x" ? "PASS" : "FAIL"
      for (let j = i + 1; j < Math.min(i + 8, lines.length); j++) {
        const stated = /Status:\s*\*{0,2}([A-Z_]+)/.exec(lines[j])
        if (stated) {
          status = stated[1]
          break
        }
      }
      state.set(entry[2], status)
    }
  }

  return state
}

/** The prompt text with every checkbox set from the ledger. */
export function reconcile(text, state) {
  return text
    .split("\n")
    .map((line) => {
      const item = new RegExp(`^- \\[([ x])\\] ${ITEM.source}`).exec(line)
      if (!item) return line

      const status = state.get(item[2])
      // An item the ledger has never mentioned is left exactly as it is. This
      // syncs what is recorded; it does not invent a decision.
      if (status === undefined) return line

      const mark = DONE.has(status) ? "x" : " "
      return line.replace(/^- \[[ x]\]/, `- [${mark}]`)
    })
    .join("\n")
}

/**
 * The prompts to operate on.
 *
 * `--prompt <path>` overrides the list so a guard can run `--check` against a
 * deliberately staled copy and assert it fails. Without that, "check mode never
 * fails" is a mutation nothing catches — the guard would only ever see the tool
 * succeed on a clean tree, which is the case that proves nothing.
 */
function promptsToCheck() {
  const flag = process.argv.indexOf("--prompt")
  if (flag !== -1 && process.argv[flag + 1]) return [process.argv[flag + 1]]
  return PROMPTS
}

function main() {
  const state = ledgerState()
  const check = process.argv.includes("--check")
  const stale = []
  let changed = 0

  for (const prompt of promptsToCheck()) {
    const text = read(prompt)
    if (text === null) continue

    const next = reconcile(text, state)
    if (next === text) continue

    if (check) {
      stale.push(prompt)
      continue
    }
    fs.writeFileSync(path.isAbsolute(prompt) ? prompt : path.join(ROOT, prompt), next)
    changed++
  }

  if (check) {
    if (stale.length > 0) {
      console.error(
        `::error::these execution prompts disagree with the ledger: ${stale.join(", ")}. ` +
          `Run: node tools/reconcile-execution-checkboxes.mjs`,
      )
      process.exit(1)
    }
    console.log(`${promptsToCheck().length} prompts agree with the ledger (${state.size} items recorded).`)
    return
  }

  console.log(`Reconciled ${changed} prompt(s) against ${state.size} recorded items.`)
}

// Importable for tests; still a script when run directly.
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main()
}
