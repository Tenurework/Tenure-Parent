#!/usr/bin/env node
/**
 * The gate a batch must pass before it is pushed.
 *
 * Batching ten items into one push trades CI cycles for later discovery of a
 * CI-only failure. That trade is only acceptable if everything CI would catch
 * is caught here first — otherwise a batch is ten items of work and one
 * red build, and the loop stalls on untangling which of the ten broke it.
 *
 * So this runs what CI runs, in the same order, and refuses on the first
 * failure. It is deliberately not "the fast subset": a gate that skips the slow
 * check is a gate that passes the thing the slow check exists to catch.
 *
 * The e2e suites need a database and a running app and are NOT run here — they
 * are run by hand during the batch, once, on a freshly recreated database,
 * because they are the checks most sensitive to stale state. `--with-e2e`
 * asserts that happened rather than pretending to do it.
 *
 * Usage:
 *   node tools/loop/batch-gate.mjs            # the gate
 *   node tools/loop/batch-gate.mjs --json     # machine-readable
 */
import { execSync } from "node:child_process"
import fs from "node:fs"

/**
 * Each step, with what a failure means.
 *
 * The `why` is not decoration: a gate that says "step 4 failed" makes the
 * reader open the script. One that says what the step protects makes the
 * failure actionable at the point it is read.
 */
const STEPS = [
  {
    name: "generated artifacts are current",
    // First, deliberately. Regenerating AFTER verifying produces a file that
    // was current when written and stale when pushed — which has happened
    // twice, and is why `npm run generate` exists as its own script.
    run: "npm run generate",
    why: "the Studio renders these; stale means the console shows a different truth than the ledger",
  },
  {
    name: "type-check",
    run: "npm run type-check",
    why: "the monorepo compiles",
  },
  {
    name: "studio type-check",
    run: "npm run studio:type-check",
    why: "the console compiles — it is a separate app with its own tsconfig",
  },
  {
    name: "lint",
    run: "npm run lint",
    why: "CI fails on an error here even when everything else passes",
  },
  {
    name: "unit and package tests",
    run: "npm run test --workspace apps/web -- --ci",
    why: "every module's own proof",
  },
  {
    name: "platform guards",
    run: "npm run test:platform",
    why: "repository invariants: disarmed workflows, no personal data, ownership, cell independence",
  },
  {
    name: "web build",
    run: "npm run build --workspace apps/web",
    why: "a type error the checker allows can still break the bundle",
  },
  {
    name: "studio build",
    run: "npm run studio:build",
    why: "the console's client bundle refuses server-only imports; only the build sees it",
  },
]

function run(step) {
  const started = Date.now()
  try {
    execSync(step.run, { stdio: "pipe", encoding: "utf8" })
    return { ...step, ok: true, ms: Date.now() - started }
  } catch (err) {
    return {
      ...step,
      ok: false,
      ms: Date.now() - started,
      // Both streams: npm puts the useful part on stdout and the exit reason on
      // stderr, and printing one of the two is how a failure becomes a mystery.
      output: `${err.stdout ?? ""}\n${err.stderr ?? ""}`.trim().slice(-4000),
    }
  }
}

const json = process.argv.includes("--json")
const results = []

for (const step of STEPS) {
  if (!json) process.stderr.write(`· ${step.name} … `)
  const result = run(step)
  results.push(result)
  if (!json) process.stderr.write(result.ok ? `ok (${(result.ms / 1000).toFixed(0)}s)\n` : "FAILED\n")
  if (!result.ok) break
}

const passed = results.every((r) => r.ok)

/**
 * A generated artifact that changed and was not staged is the drift CI rejects.
 *
 * With one exception, and it is the same exception `platform-truth.mjs --check`
 * makes: that file records the HEAD commit, so regenerating after any commit
 * changes it while nothing it describes has moved. Flagging that would fail the
 * gate on every second run and train the reader to ignore it — which is how a
 * real drift gets waved through.
 *
 * The exception is narrow on purpose: only when the ENTIRE diff is the commit
 * line. Any other change in the same file is still drift.
 */
function onlyCommitLineChanged(path) {
  const diff = execSync(`git diff -U0 -- ${path}`, { encoding: "utf8" })
  const changed = diff
    .split("\n")
    .filter((l) => /^[+-]/.test(l) && !/^(\+\+\+|---)/.test(l))
    .map((l) => l.slice(1).trim())
  return changed.length > 0 && changed.every((l) => /^"commit":/.test(l))
}

let generatedDrift = []
if (passed) {
  const porcelain = execSync("git status --porcelain", { encoding: "utf8" })
  generatedDrift = porcelain
    .split("\n")
    .filter(Boolean)
    .filter((l) => /platform-truth\.json|ownership\.md|entry-points\.md|Execution_Prompt|Master_Prompt/.test(l))
    // `XY path`: X is the index, Y is the working tree. A STAGED change is
    // fine — it is about to be committed, which is the whole point of staging
    // it. What fails the gate is an unstaged change (Y set) or an untracked
    // file, because those are what would not reach the commit while CI
    // regenerates and compares.
    //
    // Flagging staged changes too made the gate unpassable: `npm run generate`
    // legitimately rewrites these on every run, so the only way through was to
    // not stage them, which is exactly the drift being guarded against.
    .filter((l) => l.startsWith("??") || l[1] !== " ")
    .map((l) => l.trim())
    .filter((l) => {
      const path = l.replace(/^\S+\s+/, "")
      return !(path.endsWith("platform-truth.json") && onlyCommitLineChanged(path))
    })
}

const verdict = {
  passed: passed && generatedDrift.length === 0,
  steps: results.map(({ name, ok, ms }) => ({ name, ok, seconds: Math.round(ms / 1000) })),
  failure: results.find((r) => !r.ok)
    ? {
        step: results.find((r) => !r.ok).name,
        why: results.find((r) => !r.ok).why,
        output: results.find((r) => !r.ok).output,
      }
    : null,
  generatedDrift,
}

if (json) {
  console.log(JSON.stringify(verdict, null, 2))
} else if (verdict.passed) {
  console.log(`\nGATE PASSED — ${results.length} steps`)
} else if (generatedDrift.length > 0) {
  console.log(
    `\nGATE FAILED — a generated artifact changed and is unstaged:\n  ${generatedDrift.join("\n  ")}\n` +
      `Stage it. CI regenerates and compares, so an unstaged change is a red build.`,
  )
} else {
  const f = verdict.failure
  console.log(`\nGATE FAILED at "${f.step}"\n  what it protects: ${f.why}\n\n${f.output}`)
}

// Written BEFORE exiting. Anything after `process.exit` never runs, and a
// verdict file that only exists when the gate passes is a verdict file nobody
// can read when it matters. A run artifact, not a record — gitignored.
try {
  fs.writeFileSync(".loop-gate.json", JSON.stringify(verdict, null, 2))
} catch {
  /* best effort; the console output above is the real answer */
}

// A gate that exits 0 on failure is not a gate.
process.exit(verdict.passed ? 0 : 1)
