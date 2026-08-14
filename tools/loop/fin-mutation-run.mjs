/**
 * FIN-000-001 evidence: re-runs every mutation recorded in the ledger against
 * the guard test, and prints what failed each time.
 *
 * Throwaway is the wrong instinct here. The ledger's whole claim is "apply the
 * mutation, run it, confirm it fails, restore, confirm it passes", and a reader
 * who wants to disbelieve it should be able to re-run the sequence rather than
 * re-derive it from prose. It writes only to the two files it owns and restores
 * both, and it refuses to start if either is already dirty relative to the
 * backup it takes.
 *
 * Usage: node tools/loop/fin-mutation-run.mjs
 */
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { execFileSync, spawnSync } from "node:child_process"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const TOOL = path.join(ROOT, "tools/fin-finance-surface.mjs")
const DOC = path.join(ROOT, "docs/architecture/fin-finance-surface-inventory.md")
const TEST = path.join(ROOT, "tests/architecture/fin-finance-surface.test.mjs")

const toolSrc = fs.readFileSync(TOOL, "utf8")
const docSrc = fs.readFileSync(DOC, "utf8")

const regenerate = () => execFileSync(process.execPath, [TOOL], { cwd: ROOT, encoding: "utf8" })

function run() {
  const r = spawnSync(process.execPath, ["--test", TEST], { cwd: ROOT, encoding: "utf8" })
  const failed = [...r.stdout.matchAll(/^not ok \d+ - (.+)$/gm)].map((m) => m[1])
  const total = Number(/^# tests (\d+)$/m.exec(r.stdout)?.[1] ?? 0)
  return { failed, total }
}

/** Each mutation: a name, the edit, and whether the document is regenerated after it. */
const MUTATIONS = [
  {
    name: "remove the apps/web/src/lib/finance.ts rows from the committed document",
    apply: () => fs.writeFileSync(DOC, docSrc.split("\n").filter((l) => !l.startsWith("| `apps/web/src/lib/finance.ts` |")).join("\n")),
  },
  {
    name: "remove the packages/payments/src/posting.ts row from table A",
    apply: () => fs.writeFileSync(DOC, docSrc.split("\n").filter((l) => !l.startsWith("| `packages/payments/src/posting.ts` |")).join("\n")),
  },
  {
    name: "claim Journal is PRESENT in the object gap register",
    apply: () => fs.writeFileSync(DOC, docSrc.replace("| `Journal` | ABSENT |", "| `Journal` | PRESENT |")),
  },
  {
    name: "delete the general-ledger entry from CLAIM_VERDICTS",
    regenerate: true,
    apply: () => {
      const key = '"apps/web/src/lib/finance.ts|general ledger": {'
      const i = toolSrc.indexOf(key)
      const j = toolSrc.indexOf("},", i) + 3
      fs.writeFileSync(TOOL, toolSrc.slice(0, i) + toolSrc.slice(j))
    },
  },
  {
    name: "point an OBJECT_SUBSTITUTES citation at a file that does not exist",
    regenerate: true,
    apply: () => fs.writeFileSync(TOOL, toolSrc.replace("packages/finops/src/allocation.ts", "packages/finops/src/allocations.ts")),
  },
  {
    name: "claim NAME_COLLISIONS on Ledger, which no model declares",
    regenerate: true,
    apply: () =>
      fs.writeFileSync(
        TOOL,
        toolSrc.replace("export const NAME_COLLISIONS = {", 'export const NAME_COLLISIONS = {\n  Ledger: "Fabricated: no model of this name exists in the schema at all.",'),
      ),
  },
  {
    name: "make facetsOf return [] for every path",
    regenerate: true,
    apply: () => fs.writeFileSync(TOOL, toolSrc.replace("  return FACETS.filter(([, re]) => re.test(rel)).map(([name]) => name)", "  return []")),
  },
]

const restore = () => {
  fs.writeFileSync(TOOL, toolSrc)
  fs.writeFileSync(DOC, docSrc)
}

const baseline = run()
console.log(`baseline: ${baseline.total - baseline.failed.length}/${baseline.total}`)
if (baseline.failed.length > 0) {
  console.error("Refusing to run: the guard is already red.\n  " + baseline.failed.join("\n  "))
  process.exit(1)
}

let allCaught = true
for (const m of MUTATIONS) {
  m.apply()
  if (m.regenerate) regenerate()
  const { failed, total } = run()
  restore()
  regenerate()
  const after = run()
  const caught = failed.length > 0 && after.failed.length === 0
  allCaught = allCaught && caught
  console.log(`\n${caught ? "CAUGHT" : "MISSED"}  ${m.name}`)
  console.log(`  ${failed.length} of ${total} failed:`)
  for (const f of failed) console.log(`    - ${f}`)
  console.log(`  restored: ${after.total - after.failed.length}/${after.total}`)
}

console.log(`\n${allCaught ? "every mutation was caught" : "A MUTATION WAS NOT CAUGHT"}`)
process.exit(allCaught ? 0 : 1)
