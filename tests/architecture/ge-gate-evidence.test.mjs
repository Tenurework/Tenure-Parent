import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { test } from "node:test"

import { ROOT, ledgerStatuses } from "../../tools/document-graph.mjs"
import { evaluate as structuralEvaluate, phases, RANK } from "../../tools/ge-phase-gate-children.mjs"
import {
  SEEDED_REASON_TEMPLATE,
  SEEDED_ROW,
  bandMembers,
  bandsNamedBy,
  blockerSummary,
  evaluateWithEvidence,
  gateStatements,
  registryIds,
  seededRequirements,
} from "../../tools/ge-gate-evidence.mjs"

/**
 * Two things a `GE-GATE-*` row cannot currently say truthfully, and this file
 * makes it able to say.
 *
 * 1. **Which children the gate's own sentence names.** `ge-phase-gate-children.mjs`
 *    reads the authority's section structure, which is correct and partial:
 *    twenty-three of the forty-four gates quantify over a band in another
 *    family's namespace — "Every applicable `TTES-*` gate passes", "Every
 *    `EXT-010-*` item passes" — and no `## Phase N` boundary contains those rows.
 *    Two hundred and twenty children were outside every gate's blocker list.
 *
 * 2. **Whether any child was ever decided.** `tools/import-requirements.mjs`
 *    seeds an imported requirement as `Status: FAIL` + `Reason: imported from
 *    …; not yet implemented`. Nine hundred and eighty-three ledger rows are
 *    still exactly that, and `ledgerStatuses()` reports every one as `FAIL` —
 *    the same word it gives a requirement somebody built and found broken. A
 *    gate computed over them reads `FAIL`, which claims evidence nobody has.
 *    Here they resolve to undecided and the gate resolves to `UNDETERMINED`.
 *
 * Neither changes any recorded status: `ceiling("UNDETERMINED")` is `FAIL`, so
 * the rows stay `FAIL`. What changes is that a `FAIL` row can now name the child
 * that blocks it, in the family the requirement is about.
 */

test("the seeded-row pattern is the row the seeder actually writes", () => {
  // Held to the generator rather than to a copy of its output. If somebody
  // changes the wording in `import-requirements.mjs`, this fails here rather
  // than silently classifying every future stub as decided evidence.
  const seeder = fs.readFileSync(path.join(ROOT, "tools/import-requirements.mjs"), "utf8")
  assert.ok(
    seeder.includes(SEEDED_REASON_TEMPLATE),
    `tools/import-requirements.mjs no longer emits ${JSON.stringify(SEEDED_REASON_TEMPLATE)}; ` +
      "SEEDED_ROW in tools/ge-gate-evidence.mjs is matching a shape nothing produces.",
  )

  const stub =
    "- [ ] **XX-010-001** — Do the thing.\n" +
    "  - Status: FAIL\n" +
    "  - Reason: imported from `Some_Bible_v1.0.md`; not yet implemented\n" +
    "\n"
  assert.deepEqual([...stub.matchAll(SEEDED_ROW)].map((m) => m[1]), ["XX-010-001"])

  // The distinction that makes this evidence-shaped and not text-shaped: one
  // line of real evidence appended to the same row and it is no longer a stub.
  const opened = stub.replace("not yet implemented\n", "not yet implemented\n  - Evidence: somebody looked.\n")
  assert.deepEqual([...opened.matchAll(SEEDED_ROW)].map((m) => m[1]), [])

  // A decided FAIL — reason written by a person — must not match either.
  const decided =
    "- [ ] **XX-010-002** — Do the other thing.\n" +
    "  - Status: FAIL\n" +
    "  - Reason: the provisioning workflow returns 502 for every cell.\n" +
    "\n"
  assert.deepEqual([...decided.matchAll(SEEDED_ROW)].map((m) => m[1]), [])
})

test("a seeded row is present, recorded FAIL, and undecided", () => {
  const seeded = seededRequirements()
  const statuses = ledgerStatuses()

  // Floor. An empty set would make every assertion below vacuously true and
  // report a repository where every requirement had been looked at.
  assert.ok(seeded.size >= 200, `Only ${seeded.size} seeded rows found; the pattern is matching almost nothing.`)
  assert.ok(statuses.size >= 1000, `Only ${statuses.size} ledger rows parsed; the ledger shape changed.`)

  // Every one of them is reported as a decided FAIL by the status parser. That
  // is the defect, stated as an assertion rather than as prose.
  const notFail = [...seeded].filter((id) => statuses.get(id)?.status !== "FAIL").sort()
  assert.deepEqual(
    notFail,
    [],
    "A row matching the seeder's stub template is recorded as something other than FAIL. Either the " +
      "row was edited and the template no longer describes it, or a status was changed without evidence.",
  )

  // And every seeded child of a gate is carried as undecided, never as failing.
  const rows = evaluateWithEvidence({ seeded, statuses })
  const misfiled = rows.flatMap((r) => r.failing.filter((id) => seeded.has(id)).map((id) => `${r.gate}/${id}`))
  assert.deepEqual(
    misfiled,
    [],
    "A gate counts a seeded (never-opened) row among its FAILING children. 'We could not look' and " +
      "'we looked and found nothing' are different answers.",
  )
})

test("the bands a gate quantifies over come from its own sentence", () => {
  assert.deepEqual(bandsNamedBy("Every applicable `INT-*` and `PAY-*` gate passes; no provider logo counts."), [
    { band: "INT", kind: "gate" },
    { band: "PAY", kind: "gate" },
  ])
  assert.deepEqual(bandsNamedBy("Every `EXT-100-*` item and rehearsal passes; no real go-live occurs without it."), [
    { band: "EXT-100", kind: "item" },
  ])
  // The one that must NOT be read as a child set. GE-GATE-18 names `GE-*` and
  // `EXT-*` and asks that they be *unified*, which is a claim about the
  // registry. Treating it as a quantifier would make one gate the parent of
  // every GE and EXT row in the repository.
  assert.deepEqual(bandsNamedBy("`GE-*` and `EXT-*` are unified, the live/repository truth is evidenced."), [])
  assert.deepEqual(bandsNamedBy("Every enabled scope is implemented, deployed where authorized, tested."), [])

  const statements = gateStatements()
  const naming = [...statements].filter(([, s]) => bandsNamedBy(s).length > 0).map(([g]) => g)
  // A property of the authority document, not of the repository's progress, so
  // it does not move when work lands.
  assert.equal(
    naming.length,
    23,
    `${naming.length} GE gates name a band in their sentence; the authority states 23 (Phases 19-32 and 34-42).`,
  )
  assert.deepEqual(bandsNamedBy(statements.get("GE-GATE-41")), [{ band: "TTES", kind: "gate" }])
  assert.deepEqual(bandsNamedBy(statements.get("GE-GATE-19")), [{ band: "EXT-010", kind: "item" }])
})

test("cross-family children are children no section boundary contains", () => {
  const ids = registryIds()
  assert.ok(ids.length >= 2000, `Only ${ids.length} registry ids; the registry row shape changed.`)

  const rows = evaluateWithEvidence({ ids })
  assert.ok(rows.length >= 40, `Only ${rows.length} gates evaluated.`)

  const row = rows.find((r) => r.gate === "GE-GATE-41")
  // Both sides derived, so neither is a number typed in here that data can move.
  assert.deepEqual(
    row.crossFamily,
    ids.filter((id) => /^TTES-GATE-\d+$/.test(id)).sort(),
    "GE-GATE-41's sentence quantifies over every TTES gate; those are its children.",
  )
  assert.ok(row.crossFamily.length > 0, "No TTES gates resolved; the band lookup found nothing.")
  assert.ok(
    row.structural.every((id) => /^GE-410-/.test(id)),
    "Phase 41's own section holds only GE-410-* rows.",
  )
  assert.equal(
    row.structural.filter((id) => /^TTES-/.test(id)).length,
    0,
    "The structural mapping cannot reach TTES rows — which is why the sentence has to be read.",
  )
  assert.equal(row.total, row.structural.length + row.crossFamily.length)

  // Across all gates, the sentence-named children are a large set that the
  // structural evaluator never saw.
  const structural = structuralEvaluate()
  const added = rows.reduce((n, r) => n + r.crossFamily.length, 0)
  assert.ok(added >= 200, `Only ${added} cross-family children resolved across 23 gates.`)
  for (const r of rows) {
    const s = structural.find((x) => x.gate === r.gate)
    assert.ok(
      r.total >= s.total,
      `${r.gate}: merged child set (${r.total}) is smaller than the structural one (${s.total}).`,
    )
  }
})

test("a named band with no members is 'could not look', never a vacuous pass", () => {
  // Drive the whole evaluator with an empty registry: every band resolves to
  // zero members. A universally-quantified clause over an empty set is
  // vacuously true, and a gate that passes because its children were never
  // written is the worst answer available.
  //
  // Every structural child is handed a PASS and nothing is seeded, so the ONLY
  // thing that can hold a gate below PASS here is the empty band. Without that,
  // this test passed against a mutant with the rule deleted: the real ledger's
  // GE-4xx rows are all undecided stubs, so those gates read UNDETERMINED
  // whether the rule fires or not, and the probe was accepting the wrong cause.
  const allPass = new Map()
  for (const p of phases()) {
    for (const id of p.children) allPass.set(id, { status: "PASS" })
    if (p.gate) allPass.set(p.gate, { status: "FAIL" })
  }
  const empty = evaluateWithEvidence({ ids: [], statuses: allPass, seeded: new Set() })
  const banded = empty.filter((r) => r.bands.length > 0)
  assert.equal(banded.length, 23)
  for (const r of banded) {
    assert.ok(r.emptyBands.length > 0, `${r.gate} names a band and did not report it empty.`)
    assert.equal(
      r.decided.length,
      r.total,
      `${r.gate}: every child was handed PASS, so only the empty band may hold this gate down.`,
    )
    assert.equal(r.verdict, "UNDETERMINED", `${r.gate} resolved ${r.verdict} over a band with no members.`)
  }
  // …and the gates that name no band are unaffected, so the override is scoped
  // to the thing it is about rather than blanking the table.
  const unbanded = empty.filter((r) => r.bands.length === 0)
  assert.ok(unbanded.length >= 15, `Only ${unbanded.length} gates name no band.`)
  for (const r of unbanded) {
    assert.equal(r.verdict, "PASS", `${r.gate} names no band and did not pass over all-PASS children.`)
  }

  // Against the real registry: today `PAY-*` has 224 requirements and zero
  // `PAY-GATE-*` rows, so GE-GATE-36's PAY half cannot be evaluated at all.
  // Asserted as a biconditional rather than as the fact, so that writing those
  // gates changes the answer instead of reddening the test.
  const ids = registryIds()
  const row = evaluateWithEvidence({ ids }).find((r) => r.gate === "GE-GATE-36")
  const payGates = ids.filter((id) => /^PAY-GATE-\d+$/.test(id))
  assert.equal(
    row.emptyBands.includes("PAY-GATE-*"),
    payGates.length === 0,
    "GE-GATE-36 requires every applicable PAY-* gate to pass. Whether that band is reported as " +
      "unevaluable must track whether any PAY-GATE-* requirement exists.",
  )
})

test("bandMembers reads the kind the sentence used", () => {
  const ids = ["CFG-GATE-000", "CFG-010-001", "EXT-010-001", "EXT-010-002", "EXT-0100-001"]
  assert.deepEqual(bandMembers({ band: "CFG", kind: "gate" }, ids), ["CFG-GATE-000"])
  assert.deepEqual(bandMembers({ band: "EXT-010", kind: "item" }, ids), ["EXT-010-001", "EXT-010-002"])
  // Anchored: `EXT-010` must not swallow `EXT-0100-001`.
  assert.equal(bandMembers({ band: "EXT-010", kind: "item" }, ids).includes("EXT-0100-001"), false)
})

test("no GE gate is recorded above the ceiling this evidence allows", () => {
  const rows = evaluateWithEvidence()
  const over = rows
    .filter((r) => r.overclaims)
    .map((r) => `${r.gate}: recorded ${r.recorded}, this evidence permits at most ${r.allowed} — ${blockerSummary(r)}`)
  assert.deepEqual(
    over,
    [],
    "Merging the sentence-named children, or refusing to read a seeded row as a decision, has pushed a " +
      "gate's ceiling below what its row claims. Re-decide the children, not the gate.",
  )
})

test("reading the sentence can only make a gate's verdict worse, never better", () => {
  // The invariant that makes this safe to add: it adds children and removes
  // evidence, so it can never be the thing that turns a gate green.
  const mine = evaluateWithEvidence()
  const structural = structuralEvaluate()
  for (const r of mine) {
    const s = structural.find((x) => x.gate === r.gate)
    assert.ok(
      RANK[r.verdict] <= RANK[s.verdict],
      `${r.gate}: computed ${r.verdict} where the structural evaluator computed ${s.verdict}.`,
    )
  }
})

test("every gate that is not PASS names the child that blocks it", () => {
  const rows = evaluateWithEvidence()
  const mute = rows.filter((r) => r.verdict !== "PASS" && blockerSummary(r) === "")
  assert.deepEqual(
    mute.map((r) => r.gate),
    [],
    "A gate is not PASS and its blocker summary is empty — the row it produces would say FAIL and " +
      "nothing else, which is the row this module exists to replace.",
  )
  // And a gate that IS pass says so with no blockers.
  for (const r of rows.filter((r) => r.verdict === "PASS")) {
    assert.equal(blockerSummary(r), "", `${r.gate} is PASS and still names blockers.`)
  }
  assert.ok(
    rows.some((r) => r.verdict === "PASS"),
    "No gate computes PASS at all; the evaluator is failing everything and would agree with any ledger.",
  )
})

test("every phase the authority declares is evaluated exactly once", () => {
  const rows = evaluateWithEvidence()
  const declared = phases().filter((p) => p.gate !== null)
  assert.deepEqual(
    rows.map((r) => r.gate),
    declared.map((p) => p.gate),
    "The evaluated gates are not the gates the authority declares, in phase order.",
  )
  assert.equal(new Set(rows.map((r) => r.gate)).size, rows.length)
})
