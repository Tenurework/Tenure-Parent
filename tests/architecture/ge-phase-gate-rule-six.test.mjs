import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { test } from "node:test"

import { ROOT } from "../../tools/document-graph.mjs"
import {
  AUTHORITY,
  RANK,
  ceiling,
  evaluate,
  phases,
  ruleSixVerdict,
  unrecordedGates,
} from "../../tools/ge-phase-gate-children.mjs"

/**
 * Rule 6 of the master prompt's checkbox protocol, enforced over the forty-four
 * `GE-GATE-*` rows for the first time.
 *
 *   "A phase gate stays unchecked until every required child is checked or
 *    validly `BLOCKED_EXTERNAL` without weakening an invariant."
 *
 * `tests/architecture/pass-requires-evidence.test.mjs` already enforces this for
 * the other families and cannot reach these: its child derivation matches
 * `^([A-Z]+)-GATE-(\d{3})$` and then `PREFIX-NNN-\d+`, which requires the gate
 * number to be three digits and to be shared with its children. `TTES-GATE-040`
 * → `TTES-040-*` satisfies both. `GE-GATE-2` → `GE-020-*`, `GE-021-*`,
 * `GE-022-*` satisfies neither, so it abstains — correctly, since guessing would
 * be worse — and the result is that the two GE gates recorded `PASS` and the two
 * recorded `BLOCKED_EXTERNAL` have never been checked against a single child.
 *
 * The mapping comes from the authority document's own structure, which declares
 * it: one `## Phase N —` section per gate, containing the phase's `### GE-XXX:`
 * groups and ending in `### Phase N gate`.
 */

test("the authority declares one gate per phase, and the phases partition every GE requirement", () => {
  const declared = phases()

  // Floor first. Every assertion after this reads a parsed list, and a parser
  // that matched nothing would report a perfectly clean repository.
  assert.ok(declared.length >= 40, `Parsed ${declared.length} phases from ${AUTHORITY}; expected at least 40.`)

  const withoutOneGate = declared.filter((p) => p.gates.length !== 1)
  assert.deepEqual(
    withoutOneGate.map((p) => `Phase ${p.phase}: ${p.gates.length} gates (${p.gates.join(", ") || "none"})`),
    [],
    "A phase must name exactly one gate; zero means the section shape changed and the children below " +
      "are attributed to nothing, more means two gates would share one child set.",
  )

  // Numbered 0..N with no gaps — a missed heading would otherwise show up only
  // as a gate whose children silently belong to its neighbour.
  assert.deepEqual(
    declared.map((p) => p.phase),
    declared.map((_, i) => i),
    "The phase numbers are not a gapless run from 0; a `## Phase N —` heading was missed or duplicated.",
  )

  const children = declared.flatMap((p) => p.children)
  assert.equal(
    new Set(children).size,
    children.length,
    "A requirement id appears under two phases, so two gates would claim the same child.",
  )

  // The partition is checked against the generated registry rather than against
  // a number written here: 737 children + 44 gates = 781 GE rows today, and the
  // property that matters is that neither side has anything the other lacks.
  const registry = fs.readFileSync(path.join(ROOT, "docs/architecture/capability-completeness-registry.yaml"), "utf8")
  const registered = new Set([...registry.matchAll(/- id: "(GE-[^"]+)"/g)].map((m) => m[1]))
  assert.ok(registered.size >= 700, `Only ${registered.size} GE ids in the registry; the row shape changed.`)

  const covered = new Set([...children, ...declared.map((p) => p.gate)])
  const unphased = [...registered].filter((id) => !covered.has(id)).sort()
  const unregistered = [...covered].filter((id) => !registered.has(id)).sort()
  assert.deepEqual(
    unphased,
    [],
    "These GE requirements are in the registry and belong to no phase, so no gate gates them.",
  )
  assert.deepEqual(
    unregistered,
    [],
    "These ids are under a phase in the authority and absent from the registry, so the document graph " +
      "is not importing them.",
  )
})

test("the child mapping is one the identifiers could not have produced", () => {
  // The reason this module exists rather than a widened regex in the shared
  // guard. If GE gate children were derivable from digits, `GE-GATE-2` would
  // gate `GE-002-*` — and there is no such requirement.
  const two = phases().find((p) => p.phase === 2)
  assert.equal(two.gate, "GE-GATE-2")
  assert.deepEqual(
    two.children,
    [
      "GE-020-001",
      "GE-020-002",
      "GE-020-003",
      "GE-020-004",
      "GE-020-005",
      "GE-021-001",
      "GE-021-002",
      "GE-021-003",
      "GE-021-004",
      "GE-021-005",
      "GE-021-006",
      "GE-021-007",
      "GE-022-001",
      "GE-022-002",
      "GE-022-003",
      "GE-022-004",
      "GE-022-005",
      "GE-022-006",
      "GE-022-007",
      "GE-022-008",
    ],
    "Phase 2's children are the GE-020/021/022 bands; this is the mapping the gate is held to.",
  )
  assert.equal(
    two.children.filter((id) => /^GE-002-/.test(id)).length,
    0,
    "A digit-sharing heuristic would look for GE-002-*, which does not exist — which is why the " +
      "structure of the authority document is read instead.",
  )

  // Phase 13 gathers nine groups under one gate and Phase 14 gathers the five
  // GE-143 lettered sub-sections; both are cases prose names and ids do not.
  const thirteen = phases().find((p) => p.phase === 13)
  assert.ok(
    new Set(thirteen.children.map((id) => id.slice(0, 6))).size >= 9,
    "Phase 13's gate covers nine GE-13x groups; fewer means the section split is losing sub-headings.",
  )
})

test("an unread child and a failing child are different answers", () => {
  // The distinction the registry collapses. `GE-060-001` is recorded there as
  // `status: FAIL` with `reason: "imported into the execution system, not yet
  // decided"` and `ledger: null` — nobody has looked at it, and it presents
  // identically to a requirement somebody looked at and found broken. A gate
  // computed over the first kind is UNDETERMINED, not FAIL.
  const map = new Map([
    ["A", "PASS"],
    ["B", "PASS"],
    ["C", "BLOCKED_EXTERNAL"],
    ["D", "FAIL"],
  ])
  const statusOf = (id) => map.get(id)

  assert.equal(ruleSixVerdict(["A", "B"], statusOf).verdict, "PASS")
  assert.equal(ruleSixVerdict(["A", "C"], statusOf).verdict, "BLOCKED_EXTERNAL")
  assert.equal(ruleSixVerdict(["A", "D"], statusOf).verdict, "FAIL")
  // The one that matters: an id with no row is not a failure, it is an absence
  // of evidence, and it outranks the failures in the same phase.
  assert.equal(ruleSixVerdict(["A", "D", "ZZ"], statusOf).verdict, "UNDETERMINED")
  assert.deepEqual(ruleSixVerdict(["A", "D", "ZZ"], statusOf).unrecorded, ["ZZ"])
  // A phase with no children at all is also "could not look", never PASS —
  // otherwise a parsing failure would read as a passing gate.
  assert.equal(ruleSixVerdict([], statusOf).verdict, "UNDETERMINED")

  // NOT_APPLICABLE is a decision, per §4.5 of the protocol.
  const na = ruleSixVerdict(["A", "N"], (id) => (id === "N" ? "NOT_APPLICABLE" : map.get(id)))
  assert.equal(na.verdict, "PASS")
  assert.deepEqual(na.decided, ["A", "N"])
})

test("the ceiling is what Rule 6 permits and nothing better", () => {
  assert.equal(ceiling("PASS"), "PASS")
  assert.equal(ceiling("BLOCKED_EXTERNAL"), "BLOCKED_EXTERNAL")
  assert.equal(ceiling("FAIL"), "FAIL")
  // An unread phase may not be recorded blocked either: BLOCKED_EXTERNAL is a
  // positive claim that only a person's decision remains, and that claim cannot
  // be made without reading the children.
  assert.equal(ceiling("UNDETERMINED"), "FAIL")

  assert.ok(RANK.PASS > RANK.NOT_APPLICABLE)
  assert.ok(RANK.NOT_APPLICABLE > RANK.BLOCKED_EXTERNAL)
  assert.ok(RANK.BLOCKED_EXTERNAL > RANK.FAIL)
  assert.equal(RANK.UNDETERMINED, RANK.FAIL)
})

/**
 * Which GE gates are recorded better than their children allow.
 *
 * A ratchet, not a rule, and for the same reason `oidc-trust.test.mjs` keeps
 * one: the fix is a ledger edit, and this test is not the thing that gets to
 * make it. The list may only shrink. Correcting a gate's row means deleting its
 * entry in the same commit, which is the moment somebody notices.
 */
const KNOWN_OVERCLAIMS = new Map([
  [
    "GE-GATE-1",
    // Recorded BLOCKED_EXTERNAL over nineteen children, one of which — GE-010-006,
    // "prove nonproduction roles cannot reach production resources" — has no
    // ledger row at all. It is named in prose inside GE-010's other rows and in
    // `docs/architecture/ge-landing-zone-model.md`, and never decided. The
    // gate's own reason says "three of its children are blocked on the
    // Organization", which is a claim about the eighteen that were read.
    "GE-010-006 has no ledger row; the gate claims BLOCKED_EXTERNAL over a child nobody decided",
  ],
])

test("no GE gate is recorded better than Rule 6 allows", () => {
  const rows = evaluate()

  // Floor: an evaluator that produced no rows would agree with every ledger.
  assert.ok(rows.length >= 40, `Only ${rows.length} GE gates evaluated; the phase or gate shape changed.`)
  assert.ok(
    rows.some((r) => r.total >= 10),
    "No evaluated gate has ten children; the child regex is matching almost nothing.",
  )

  const unexpected = rows
    .filter((r) => r.overclaims && !KNOWN_OVERCLAIMS.has(r.gate))
    .map(
      (r) =>
        `${r.gate}: recorded ${r.recorded}, children permit at most ${r.allowed} ` +
        `(${r.decided.length}/${r.total} decided, ${r.failing.length} FAIL, ${r.unrecorded.length} with no row)`,
    )
  assert.deepEqual(
    unexpected,
    [],
    "A GE phase gate claims a status its children do not support. Rule 6: a phase gate stays " +
      "unchecked until every required child is checked or validly BLOCKED_EXTERNAL. Re-decide the " +
      "children rather than the gate.",
  )

  // Staleness, in both directions. An entry that no longer over-claims has been
  // fixed and must come off the list, or the list stops meaning anything.
  const stale = [...KNOWN_OVERCLAIMS.keys()].filter((gate) => {
    const row = rows.find((r) => r.gate === gate)
    return row === undefined || !row.overclaims
  })
  assert.deepEqual(
    stale,
    [],
    "These gates are on the known-over-claim list and no longer over-claim. Delete their entries " +
      "from KNOWN_OVERCLAIMS — a ratchet that never shrinks is an allowlist.",
  )
  assert.ok(KNOWN_OVERCLAIMS.size <= 1, "the known-over-claim list grew; it may only shrink")
})

test("every gate the authority names has a ledger row", () => {
  // The gates themselves are all recorded, unlike a third of their children.
  // Asserted rather than assumed, because a gate with no row would compute a
  // verdict against nothing and quietly never over-claim.
  assert.deepEqual(
    unrecordedGates(),
    [],
    "These GE-GATE ids are declared by the authority and no ledger has a row for them.",
  )
})

test("the computed verdict is reported for every gate, so a FAIL row can name its blocker", () => {
  const rows = evaluate()
  // Each gate must resolve to one of the four verdicts, and the detail behind it
  // must be non-empty whenever the verdict is not PASS — a FAIL that cannot say
  // which child failed is the row this whole file exists to replace.
  const mute = rows.filter(
    (r) =>
      r.verdict !== "PASS" && r.failing.length === 0 && r.unrecorded.length === 0 && r.blocked.length === 0,
  )
  assert.deepEqual(
    mute.map((r) => r.gate),
    [],
    "A gate is not PASS and names no child as the reason.",
  )
  const verdicts = new Set(rows.map((r) => r.verdict))
  for (const v of verdicts) {
    assert.ok(["PASS", "FAIL", "BLOCKED_EXTERNAL", "UNDETERMINED"].includes(v), `unknown verdict ${v}`)
  }
})
