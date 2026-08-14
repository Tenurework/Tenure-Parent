/**
 * FIN-000-001. The finance inventory is re-derived, not believed.
 *
 * `docs/architecture/fin-finance-surface-inventory.md` is a claim about this
 * repository: these files are the finance surface, these tables carry money,
 * these canonical accounting objects do not exist, and these capability terms
 * the source utters have been adjudicated. Every one of those claims rots the
 * moment somebody adds a file, renames a model or writes a comment saying the
 * platform does something it does not.
 *
 * A committed inventory nobody re-derives is indistinguishable from a plausible
 * paragraph, and a plausible paragraph is the specific failure this programme
 * keeps shipping. So the document is generated, and this asserts five things
 * the generator cannot assert about itself:
 *
 *   1. It is current — the generator's `--check` re-runs the scan in a
 *      subprocess and compares.
 *   2. Every path it names exists, including the paths cited inside the prose
 *      of the substitute and verdict tables. A citation to a deleted file is
 *      how an inventory becomes fiction while still looking measured.
 *   3. No capability claim is left `UNADJUDICATED`, so a new claim in the tree
 *      cannot be absorbed silently.
 *   4. Every `NAME_COLLISIONS` entry names a model the schema really declares.
 *   5. The classifier is not vacuous. A `facetsOf` that returned `[]` for
 *      everything would produce an empty inventory, an empty claim table, zero
 *      unadjudicated claims — and would pass 1, 2, 3 and 4 while reporting that
 *      the platform has no finance code at all.
 *
 * Runner: `node --test` over `tests/**` — i.e. `npm run test:platform`. Bare
 * node, no jest globals, no TypeScript.
 */
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { execFileSync } from "node:child_process"
import { test } from "node:test"

import {
  CLAIM_TERMS,
  CLAIM_VERDICTS,
  NAME_COLLISIONS,
  OBJECT_SUBSTITUTES,
  OUT,
  ROOT,
  SCHEMA,
  canonicalObjects,
  claims,
  collect,
  facetsOf,
  kindOf,
  planeOf,
  read,
  render,
  schemaDeclares,
} from "../../tools/fin-finance-surface.mjs"

const DOC = path.join(ROOT, OUT)

/** Every backticked thing in the document that looks like a repository path. */
function citedPaths(text) {
  const out = new Set()
  for (const m of text.matchAll(/`([\w./@[\]()-]+\.(?:ts|tsx|mjs|prisma|sql|md|yaml|yml|json))`/g)) {
    out.add(m[1])
  }
  return [...out].sort()
}

test("the committed inventory is what the tree currently says", () => {
  // A subprocess, not an in-process re-render, because `--check` is the command
  // a person and CI will run and it is the thing that has to work. The
  // generator refuses to write on import, so this cannot heal the file first.
  const out = execFileSync(process.execPath, [path.join(ROOT, "tools", "fin-finance-surface.mjs"), "--check"], {
    cwd: ROOT,
    encoding: "utf8",
  })
  assert.match(out, /is up to date/)
})

test("the inventory is not empty, and the classifier is not vacuous", () => {
  // Everything below passes trivially on an empty inventory. Exercised
  // directly so a classifier that stopped matching is caught here, loudly,
  // rather than turning every other assertion in this file into a no-op.
  assert.deepEqual(facetsOf("apps/web/src/lib/finance.ts"), ["finance"])
  assert.deepEqual(facetsOf("apps/web/src/app/(app)/orgs/[slug]/finance/actions.ts"), ["finance"])
  assert.deepEqual(facetsOf("apps/web/src/components/finance/LedgerDrawer.tsx"), ["ledger", "finance"])
  assert.deepEqual(facetsOf("packages/payments/src/posting.ts"), ["ledger", "payment"])
  assert.deepEqual(facetsOf("apps/web/src/lib/rbac.ts"), [], "rbac is not finance code and must not be inventoried")

  assert.equal(planeOf("apps/web/src/lib/finance.ts"), "tenant")
  assert.equal(planeOf("apps/system-studio/src/lib/cost-report.ts"), "operator")
  assert.equal(planeOf("packages/payments/src/posting.ts"), "shared")

  assert.equal(kindOf("apps/web/e2e/finance.spec.ts"), "e2e")
  assert.equal(kindOf("apps/web/src/lib/finance.test.ts"), "test")
  assert.equal(kindOf("apps/web/src/app/(app)/orgs/[slug]/finance/money-path.itest.ts"), "test")
  assert.equal(kindOf("apps/web/src/lib/finance.ts"), "source")

  const data = collect()
  assert.ok(data.files.length >= 60, `The finance surface came out at ${data.files.length} files, which is too few to be real.`)
  assert.ok(data.models.length >= 8, `Only ${data.models.length} money-bearing tables were found.`)
  assert.ok(data.claims.length >= 10, `Only ${data.claims.length} capability claims were found.`)
  assert.equal(data.objects.length, 20, "Bible §3.2 names twenty objects.")

  // The three files the requirement is actually about have to be in it.
  const paths = new Set(data.files.map((f) => f.path))
  for (const required of [
    "apps/web/src/lib/finance.ts",
    "apps/web/src/app/(app)/orgs/[slug]/finance/actions.ts",
    "packages/payments/src/posting.ts",
  ]) {
    assert.ok(paths.has(required), `${required} is finance code and is missing from the inventory.`)
  }
})

test("the surface table names exactly the finance files in the tree", () => {
  // The membership claim, checked on its own rather than only through byte
  // equality. Byte equality reds for any reason at all — a reworded heading
  // reds it too — and a check that reds for every reason teaches people to
  // regenerate without reading the diff. This one reds for one reason: a
  // finance file exists that the document does not name, or the document names
  // one that no longer exists.
  const text = read(OUT)
  const table = text.slice(text.indexOf("## A. The finance surface"), text.indexOf("## B."))
  const documented = [...table.matchAll(/^\| `([^`]+)` \|/gm)].map((m) => m[1]).sort()
  const actual = collect().files.map((f) => f.path).sort()

  const missing = actual.filter((p) => !documented.includes(p))
  const extra = documented.filter((p) => !actual.includes(p))
  assert.deepEqual(missing, [], "Finance files in the tree that the inventory does not name:\n" + missing.join("\n"))
  assert.deepEqual(extra, [], "Files the inventory names that are not finance files in the tree:\n" + extra.join("\n"))
  assert.ok(documented.length >= 60, `The surface table has only ${documented.length} rows.`)
})

test("every path the inventory cites is a path that exists", () => {
  const text = read(OUT)
  const missing = citedPaths(text).filter((p) => !fs.existsSync(path.join(ROOT, p)))
  assert.deepEqual(
    missing,
    [],
    "The inventory cites files that are not in the tree:\n" +
      missing.join("\n") +
      "\nA measured document that cites a deleted file is fiction with a line count.",
  )
})

test("every capability claim the surface makes has been adjudicated", () => {
  const found = claims(collect().files.map((f) => f.path))
  const open = found.filter((c) => c.verdict === "UNADJUDICATED").map((c) => c.key)
  assert.deepEqual(
    open,
    [],
    "These capability claims have no verdict in CLAIM_VERDICTS:\n" +
      open.join("\n") +
      "\nSomebody has to read the line and decide whether the code does what the word means. " +
      "That is the whole of FIN-000-001's second half and it cannot be automated.",
  )
  // And the verdicts that exist have to be one of the three, not a fourth word
  // somebody invented that renders as an adjective.
  const bad = found.filter((c) => !["TRUE", "SCOPED", "OVERSTATED"].includes(c.verdict))
  assert.deepEqual(bad.map((c) => `${c.key}=${c.verdict}`), [])
  // The point of the exercise: at least one claim was found to be false. If
  // this ever goes to zero it is because the claims were fixed, and the fix is
  // to record that here rather than to delete the assertion.
  assert.ok(
    found.some((c) => c.verdict === "OVERSTATED"),
    "No OVERSTATED claim remains. If the overstatements were genuinely corrected, update this assertion and say so.",
  )
})

test("no verdict is recorded for a file or term that is not real", () => {
  // A verdict table is a second place to write fiction. Every key has to name a
  // file that exists and a term the scanner actually looks for, or the entry is
  // adjudicating something nobody will ever find.
  const wrong = []
  for (const key of Object.keys(CLAIM_VERDICTS)) {
    const [file, term] = key.split("|")
    if (!fs.existsSync(path.join(ROOT, file))) wrong.push(`${key}: no such file`)
    else if (!CLAIM_TERMS.includes(term)) wrong.push(`${key}: "${term}" is not in CLAIM_TERMS`)
    else if (!read(file).toLowerCase().includes(term)) wrong.push(`${key}: the file does not contain the term`)
  }
  assert.deepEqual(wrong, [], "CLAIM_VERDICTS adjudicates claims that do not exist:\n" + wrong.join("\n"))
})

test("the object gap register is measured against the schema", () => {
  const text = read(SCHEMA)
  const objects = canonicalObjects()

  // Every collision claim is checkable, and checked. Claiming `Account` is
  // taken when no `model Account` exists would turn an honest ABSENT into a
  // hazard nobody has.
  for (const [name, why] of Object.entries(NAME_COLLISIONS)) {
    assert.ok(schemaDeclares(text, name), `NAME_COLLISIONS says \`${name}\` is taken, and ${SCHEMA} declares no such model.`)
    assert.ok(why.length > 20, `NAME_COLLISIONS.${name} says nothing about what took the name.`)
  }

  // The register only ever reports what the schema says. Proven by asserting
  // the two directions on real names rather than trusting the function.
  assert.equal(schemaDeclares(text, "LedgerEntry"), true)
  assert.equal(schemaDeclares(text, "Journal"), false, "If a Journal table has landed, FIN-000-003 has moved and this register is out of date.")

  for (const o of objects) {
    assert.ok(["PRESENT", "ABSENT", "NAME TAKEN"].includes(o.state), `${o.name} has state "${o.state}".`)
    if (o.state === "NAME TAKEN") assert.equal(o.satisfied, false, "A taken name is not coverage.")
    assert.ok(OBJECT_SUBSTITUTES[o.name] !== undefined, `${o.name} has no note saying what stands in for it.`)
  }
})

test("the document the generator renders is the document on disk", () => {
  // The `--check` above proves it in a subprocess. This proves it again in
  // process, so a failure says WHICH bytes differ instead of only that they do.
  const generated = render(collect())
  const committed = fs.readFileSync(DOC, "utf8").replace(/\r\n/g, "\n")
  if (generated !== committed) {
    const g = generated.split("\n")
    const c = committed.split("\n")
    const at = g.findIndex((line, i) => line !== c[i])
    assert.fail(
      `${OUT} is stale at line ${at + 1}.\n  committed: ${c[at]}\n  generated: ${g[at]}\n` +
        "Run: node tools/fin-finance-surface.mjs",
    )
  }
})
