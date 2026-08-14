/**
 * CAT-000-004 — the bindings are opened, not read.
 *
 * A mapping document's failure mode is not a typo. It is that the document
 * keeps naming a Bible, a ledger or a module that was renamed, and a reader
 * takes the correspondence on trust because checking it means opening nine
 * files. So this opens all of them, every run.
 *
 * What it is designed to catch, stated so a reader can go and try it:
 *
 *   * point a surface at a Bible or ledger that does not exist — "every target
 *     the bindings name exists" reds with the path.
 *   * drop a surface from `SURFACES` — the set no longer equals the nine names
 *     parsed out of CAT-000-004's own sentence in the Bible, and the equality
 *     test reds in both directions.
 *   * add a `CAT-*` requirement to the ledger without a phase binding — the
 *     coverage test reds naming the unbound id.
 *   * edit the committed markdown — the freshness test reds.
 *
 * Runner: `npm run test:platform` (plain `node --test`).
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"

import {
  BINDINGS_DOC,
  PHASE_BINDINGS,
  ROOT,
  SURFACES,
  bindingsByPhase,
  render,
  requirements,
  surfaceNames,
} from "../../tools/cat-requirement-bindings.mjs"

const exists = (p) => fs.existsSync(path.join(ROOT, p))

test("the committed binding document is what the tool produces today", () => {
  const abs = path.join(ROOT, BINDINGS_DOC)
  const current = fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : ""
  assert.equal(
    current,
    render(),
    `${BINDINGS_DOC} is stale. Run: node tools/cat-requirement-bindings.mjs`,
  )
})

test("the surfaces are exactly the ones CAT-000-004 names", () => {
  const fromBible = surfaceNames()
  assert.equal(
    fromBible.length,
    9,
    `CAT-000-004 names ${fromBible.length} surfaces, not 9 — re-read the requirement`,
  )
  // Both directions. A subset check passes a table that quietly dropped one,
  // and a superset check passes a table that invented one.
  assert.deepEqual(
    SURFACES.map((s) => s.name).sort(),
    [...fromBible].sort(),
    "the binding table and the requirement disagree about which surfaces exist",
  )
})

test("every target the bindings name exists", () => {
  const missing = []
  for (const s of SURFACES) {
    assert.ok(s.bibles.length > 0, `${s.name} binds to no governing document`)
    assert.ok(s.anchors.length > 0, `${s.name} binds to no code`)
    assert.ok(
      s.owns.length > 60,
      `${s.name} says nothing about what it owns — a binding with no reason is a column, ` +
        `not a correspondence`,
    )
    for (const p of [...s.bibles, s.ledger, ...s.anchors]) {
      if (!exists(p)) missing.push(`${s.name} → ${p}`)
    }
  }
  assert.deepEqual(missing, [], `bindings that name a path nobody has:\n  ${missing.join("\n  ")}`)
})

test("every phase binds to surfaces that exist in the table", () => {
  const unknown = []
  for (const p of bindingsByPhase()) {
    assert.ok(p.resolved.length > 0, `${p.phase} binds to nothing`)
    for (const r of p.resolved) {
      if (!r.surface) unknown.push(`${p.phase} → ${r.key}`)
      else assert.ok(r.why.length > 20, `${p.phase} → ${r.key} has no stated reason`)
    }
  }
  assert.deepEqual(unknown, [], `phases naming a surface key nothing declares:\n  ${unknown.join("\n  ")}`)
})

test("every CAT requirement in the ledger is bound to a phase", () => {
  const reqs = requirements()
  assert.ok(reqs.length >= 59, `only ${reqs.length} CAT requirements parsed — the scan is broken`)

  const bound = new Set(PHASE_BINDINGS.map((p) => p.phase))
  const unbound = reqs.filter((r) => !bound.has(r.phase)).map((r) => `${r.id} (phase ${r.phase})`)
  assert.deepEqual(
    unbound,
    [],
    `CAT-000-004 asks that EVERY catalog requirement be bound; these are not:\n  ` +
      unbound.join("\n  ") +
      `\n\nAdd the phase to PHASE_BINDINGS in tools/cat-requirement-bindings.mjs.`,
  )

  // A gate belongs to the phase it closes. If that derivation breaks, gates
  // silently land in a phase of their own and the check above stops meaning
  // anything, because an unbound phase is what it looks for.
  const gates = reqs.filter((r) => r.isGate)
  assert.ok(gates.length >= 10, `only ${gates.length} gates found — the phase derivation broke`)
  for (const g of gates) assert.ok(bound.has(g.phase), `${g.id} derived phase ${g.phase}`)
})

test("every surface is actually used by at least one phase", () => {
  const used = new Set(PHASE_BINDINGS.flatMap((p) => p.surfaces.map(([k]) => k)))
  const idle = SURFACES.filter((s) => !used.has(s.key)).map((s) => s.name)
  assert.deepEqual(
    idle,
    [],
    `these surfaces are declared and bound to nothing, which is a table entry rather than a ` +
      `binding:\n  ${idle.join("\n  ")}`,
  )
})

test("the bindings do not claim work that is done", () => {
  /*
   * The document's opening paragraph states how many CAT requirements are
   * closed. That is a statement about another file, so it is DERIVED from that
   * file rather than typed — and this asserts the derivation still reads the
   * ledger, because a paragraph frozen to a literal would leave the freshness
   * test green while the sentence quietly became false.
   */
  const ledger = fs.readFileSync(
    path.join(ROOT, "docs/implementation/connection-composer-execution-ledger.md"),
    "utf8",
  )
  const closed = [...ledger.matchAll(/- \[[xX]\] \*\*(CAT-[A-Z0-9-]+)\*\*/g)].map((m) => m[1])
  const doc = fs.readFileSync(path.join(ROOT, BINDINGS_DOC), "utf8")

  assert.ok(
    doc.includes(`${closed.length} of ${requirements().length} \`CAT-*\` requirements are closed`),
    `${BINDINGS_DOC} does not report the ledger's ${closed.length} closed requirements`,
  )
  for (const id of closed) {
    assert.ok(doc.includes(`\`${id}\``), `${BINDINGS_DOC} omits the closed requirement ${id}`)
  }
  // And the claim is a real constraint: a document that said "59 of 59" would
  // be claiming the whole Bible is built.
  assert.ok(closed.length < requirements().length, "the ledger claims every CAT requirement is closed")
})
