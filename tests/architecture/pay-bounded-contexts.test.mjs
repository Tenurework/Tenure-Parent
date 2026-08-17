/**
 * PAY-020-001 — the bounded-context ownership and dependency diagram, recomputed.
 *
 * `docs/payments/bounded-contexts.md` states which of Bible §4's twelve domains
 * exist in this repository, which files own them, what each payments module
 * imports, and the context-level graph that falls out of it. Every one of those
 * is a claim about the tree, so every one of them is checked here against the
 * tree rather than read.
 *
 * The load-bearing assertion is the last one. The context diagram is DERIVED —
 * the guard maps each module edge onto its context, drops the intra-context
 * ones, and requires the mermaid arrows to be exactly that set. An arrow the
 * code does not justify fails, and so does a real dependency the diagram omits.
 * A diagram that is only read is a drawing of what somebody believed on the day
 * they drew it, and `modules/index.ts` records what that cost the last time: a
 * served-routes check that compared two hand-written lists and could not fail.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, "../..")

const DOC = "docs/payments/bounded-contexts.md"
const BIBLE = "Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md"
const SRC = "packages/payments/src"

/** Modules that are not a context's: the public surface and the tests. */
const NOT_A_MODULE = /^(index)$|\.test$/

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8")
}

/** Bible §4's twelve domains, in its order, from its own numbered list. */
function bibleContexts() {
  const text = read(BIBLE)
  const start = text.indexOf("Implement the following bounded domains:")
  assert.ok(start > 0, `Bible §4's bounded-domain list is gone from ${BIBLE}.`)
  const block = text.slice(start, start + 4000)
  return [...block.matchAll(/^\d+\.\s+\*\*([^:*]+):\*\*/gm)].map((m) => m[1].trim())
}

/** Rows of a `| a | b | c |` table, by the text of its header's first cell. */
function tableRows(doc, firstHeader) {
  const lines = doc.split(/\r?\n/)
  const start = lines.findIndex((l) => l.startsWith(`| ${firstHeader} |`))
  assert.ok(start >= 0, `no table in ${DOC} whose first column is "${firstHeader}".`)
  const rows = []
  for (const line of lines.slice(start + 2)) {
    if (!line.startsWith("|")) break
    rows.push(
      line
        .split("|")
        .slice(1, -1)
        .map((cell) => cell.trim()),
    )
  }
  return rows
}

/** Backticked cells split on commas, with `—` meaning none. */
function backticked(cell) {
  if (cell === "—") return []
  return [...cell.matchAll(/`([^`]+)`/g)].map((m) => m[1])
}

/** Every module in the package, and every intra-package module it imports. */
function realModuleEdges() {
  const out = new Map()
  for (const file of fs.readdirSync(path.join(ROOT, SRC))) {
    if (!file.endsWith(".ts")) continue
    const name = file.replace(/\.ts$/, "")
    if (NOT_A_MODULE.test(name)) continue
    const text = read(`${SRC}/${file}`)
    const specs = new Set()
    for (const m of text.matchAll(
      /(?:^|\n)\s*(?:import|export)\s[\s\S]{0,600}?from\s+["']\.\/([^"']+)["']/g,
    )) {
      specs.add(m[1])
    }
    out.set(name, [...specs].sort())
  }
  return out
}

test("the document names Bible §4's twelve contexts, in Bible §4's order", () => {
  const contexts = bibleContexts()
  // Pinned by value first: a parser returning [] would make the row check below
  // pass against a table with no rows at all.
  assert.deepEqual(contexts, [
    "Payments Configuration Plane",
    "Merchant Account Service",
    "Payment Orchestration Service",
    "Funds Flow Service",
    "Payout Service",
    "Disbursement Service",
    "Financial Account Service",
    "Cards Service",
    "Risk and Disputes Service",
    "Payments Ledger Adapter",
    "Provider Gateway",
    "Payments Operations Center",
  ])

  const rows = tableRows(read(DOC), "#")
  assert.equal(rows.length, 12, `the ownership table has ${rows.length} rows, not 12.`)
  rows.forEach((row, i) => {
    assert.equal(row[0], String(i + 1), `row ${i + 1} is numbered ${row[0]}.`)
    assert.equal(
      row[1],
      contexts[i],
      `row ${i + 1} names "${row[1]}"; Bible §4 calls it "${contexts[i]}".`,
    )
    assert.ok(["partial", "absent"].includes(row[2]), `row ${i + 1} status "${row[2]}" is neither.`)
  })
})

test("a context claiming code names files that exist, and one claiming none names none", () => {
  const wrong = []
  for (const row of tableRows(read(DOC), "#")) {
    const paths = backticked(row[3])
    if (row[2] === "absent") {
      if (paths.length > 0) wrong.push(`${row[1]} is absent and cites ${paths.join(", ")}`)
      continue
    }
    if (paths.length === 0) wrong.push(`${row[1]} is partial and cites no file`)
    for (const file of paths) {
      if (!fs.existsSync(path.join(ROOT, file))) wrong.push(`${row[1]} cites ${file}, which is gone`)
    }
  }
  assert.deepEqual(wrong, [], `the ownership table disagrees with the tree:\n  ${wrong.join("\n  ")}`)
})

test("every repository path the document cites exists", () => {
  // Not only the table: the prose names files too, and a document whose prose
  // has drifted is the one somebody reads instead of the code.
  const cited = new Set(
    [...read(DOC).matchAll(/`((?:apps|packages|docs|modules|blueprints|tools|tests)\/[^`]+)`/g)].map(
      (m) => m[1],
    ),
  )
  assert.ok(cited.size >= 15, `only ${cited.size} repository paths cited — the reader is broken.`)
  const missing = [...cited].filter((p) => !fs.existsSync(path.join(ROOT, p))).sort()
  assert.deepEqual(missing, [], `${DOC} cites paths that do not exist: ${missing.join(", ")}`)
})

test("the module table is every module, with its real imports", () => {
  const real = realModuleEdges()
  assert.ok(real.size >= 14, `only ${real.size} modules found in ${SRC} — the reader is broken.`)

  const declared = new Map()
  const contexts = new Map()
  for (const row of tableRows(read(DOC), "Module")) {
    const [name] = backticked(row[0])
    declared.set(name, backticked(row[2]).sort())
    contexts.set(name, row[1])
  }

  const known = new Set(bibleContexts())
  const problems = []

  for (const [name, imports] of real) {
    if (!declared.has(name)) {
      problems.push(
        `${name} is a module in ${SRC} and has no row in ${DOC}. Add one: its context and its ` +
          `imports (${imports.join(", ") || "none"}). An undocumented module is what publishing ` +
          `an ownership diagram is supposed to prevent.`,
      )
      continue
    }
    if (!known.has(contexts.get(name))) {
      problems.push(`${name} is filed under "${contexts.get(name)}", which is not a Bible §4 context.`)
    }
    const want = imports.join(", ") || "none"
    const got = declared.get(name).join(", ") || "none"
    if (want !== got) problems.push(`${name} imports ${want}; the table says ${got}.`)
  }
  for (const name of declared.keys()) {
    if (!real.has(name)) problems.push(`${DOC} has a row for ${name}, which is not a module in ${SRC}.`)
  }

  assert.deepEqual(problems, [], `the module table disagrees with the imports:\n  ${problems.join("\n  ")}`)
})

test("the context diagram is exactly the graph the imports produce", () => {
  const doc = read(DOC)
  const contexts = bibleContexts()
  const numberOf = new Map(contexts.map((name, i) => [name, i + 1]))

  const context = new Map()
  for (const row of tableRows(doc, "Module")) context.set(backticked(row[0])[0], row[1])

  // Derived, not read: map every real module edge onto its context pair and
  // drop the ones that stay inside one context.
  const derived = new Set()
  for (const [name, imports] of realModuleEdges()) {
    const from = numberOf.get(context.get(name))
    for (const target of imports) {
      const to = numberOf.get(context.get(target))
      assert.ok(from && to, `${name} → ${target}: one of them has no context in ${DOC}.`)
      if (from !== to) derived.add(`C${from} --> C${to}`)
    }
  }
  assert.ok(derived.size >= 4, `only ${derived.size} cross-context edges derived — the map is broken.`)

  const mermaid = doc.match(/```mermaid\n([\s\S]*?)```/)
  assert.ok(mermaid, `${DOC} has no mermaid block, so it publishes no diagram.`)
  const drawn = new Set(
    [...mermaid[1].matchAll(/^\s*(C\d+ --> C\d+)\s*$/gm)].map((m) => m[1]),
  )

  const undrawn = [...derived].filter((e) => !drawn.has(e)).sort()
  const unjustified = [...drawn].filter((e) => !derived.has(e)).sort()
  assert.deepEqual(undrawn, [], `the diagram omits real dependencies: ${undrawn.join(", ")}`)
  assert.deepEqual(unjustified, [], `the diagram draws arrows the code does not: ${unjustified.join(", ")}`)

  // Every context is a node, including the seven with no code — a diagram that
  // omitted them would read as a system with five parts.
  for (let i = 1; i <= 12; i += 1) {
    assert.ok(
      new RegExp(`^\\s*C${i}\\[`, "m").test(mermaid[1]),
      `the diagram has no node C${i} (${contexts[i - 1]}).`,
    )
  }
})
