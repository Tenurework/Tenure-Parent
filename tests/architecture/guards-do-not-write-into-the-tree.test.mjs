import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"

/**
 * A guard may not write into the repository it is scanning.
 *
 * `operator-plane-content` used to prove its pattern by writing
 * `apps/system-studio/src/lib/.content-probe.ts`, grepping for it, and deleting
 * it. Sound in isolation. The suite runs its files in parallel, so for the few
 * hundred milliseconds that file existed, every guard that walks the tree saw
 * something that is not in the repository — and `ownership-map.mjs --check`
 * compared the tree against the committed map, found an extra file, and
 * reported the map stale.
 *
 * `test:platform` therefore went red in roughly one run in four, in a test that
 * had nothing to do with the one at fault, with a message telling whoever read
 * it to regenerate a file that was already correct. That is the expensive kind
 * of flake: it accuses the wrong thing, and the accusation is plausible.
 *
 * The rule is narrow on purpose. Writing to `os.tmpdir()` is fine and several
 * guards do it — `prompt-matches-ledger` copies a ledger into a temp directory
 * to prove its own detector. What is forbidden is a path built from the
 * repository root.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, "../..")
const TEST_DIRS = ["tests"]

/** Writers. Reading is what a guard is for; these are the calls that mutate. */
const WRITE_CALLS = [
  "writeFileSync",
  "appendFileSync",
  "mkdirSync",
  "rmSync",
  "unlinkSync",
  "renameSync",
  "copyFileSync",
  "cpSync",
  "writeFile(",
  "symlinkSync",
]

function testFiles() {
  const out = []
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (/\.(test|spec)\.[cm]?js$/.test(entry.name)) out.push(full)
    }
  }
  for (const dir of TEST_DIRS) {
    const abs = path.join(ROOT, dir)
    if (fs.existsSync(abs)) walk(abs)
  }
  return out
}

/**
 * Lines that both write and name a repository path.
 *
 * Shared with the self-test below so that a detector which stops detecting
 * fails a test rather than passing quietly.
 */
export function treeWrites(lines, where) {
  const found = []
  lines.forEach((line, i) => {
    const writes = WRITE_CALLS.some((call) => line.includes(`.${call}`) || line.includes(call))
    if (!writes) return
    // A path built from the repository root. `os.tmpdir()` and a bare variable
    // are both fine — the first is the sanctioned escape and the second is
    // resolved somewhere this cannot see, which the reviewer has to judge.
    if (/\bROOT\b/.test(line) || /join\(\s*["'`]\.{1,2}\//.test(line)) {
      found.push(`${where}:${i + 1} — ${line.trim().slice(0, 100)}`)
    }
  })
  return found
}

test("the detector flags a write under ROOT and nothing else", () => {
  // Assembled rather than written out, so these fixtures are not themselves
  // flagged when the guard below reads this file. Exempting the file would have
  // been easier and would blind the guard to a real write added here later.
  const WRITE = `write${"FileSync"}`
  const READ = `read${"FileSync"}`
  const REMOVE = `rm${"Sync"}`
  const flagged = treeWrites(
    [
      `  fs.${WRITE}(path.join(ROOT, 'a.ts'), 'x')`,
      `  fs.${WRITE}(path.join(os.tmpdir(), 'a.ts'), 'x')`,
      `  const source = fs.${READ}(path.join(ROOT, 'a.ts'), 'utf8')`,
      `  fs.${REMOVE}(dir, { recursive: true })`,
    ],
    "synthetic",
  )
  assert.equal(flagged.length, 1, `expected exactly one flag, got ${flagged.length}`)
  assert.match(flagged[0], /synthetic:1/)
})

test("this test can see the guard files", () => {
  // Every assertion below passes trivially against an empty list.
  const files = testFiles()
  assert.ok(
    files.length >= 20,
    `Found ${files.length} guard files, expected at least 20. A scan that stops finding files ` +
      `reports no violations and passes.`,
  )
})

test("no guard writes into the repository it is scanning", () => {
  const violations = []
  for (const file of testFiles()) {
    const rel = path.relative(ROOT, file).split(path.sep).join("/")
    const lines = fs.readFileSync(file, "utf8").split(String.fromCharCode(10))
    violations.push(...treeWrites(lines, rel))
  }

  assert.deepEqual(
    violations,
    [],
    "A guard writes into the tree it scans:" +
      String.fromCharCode(10) +
      violations.join(String.fromCharCode(10)) +
      String.fromCharCode(10) +
      "Guards run in parallel, so for as long as that file exists every tree-scanning guard is " +
      "looking at a repository that does not match the one committed — and the failure surfaces " +
      "in whichever of them happened to be running. Write to os.tmpdir(), or prove the point " +
      "against code that is already there.",
  )
})
