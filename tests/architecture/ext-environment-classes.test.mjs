/**
 * EXT-020-001 — the environment class registry covers every class in §4.1, and
 * the combination rule refuses the combinations §4.1 forbids.
 *
 * The corpus half asserts facts about the real extension. The fixture half
 * drives the parser and the combination rule off text written here, so the
 * failure branches are proven to fire rather than left as code nobody watched.
 */
import assert from "node:assert/strict"
import test from "node:test"

import {
  AXES,
  AXES_FROM_4_1,
  AXES_NOT_IN_4_1,
  AUTHORITY_RUNGS,
  CLASS_FIELDS,
  DATA_RUNGS,
  DESTRUCTION_RUNGS,
  RUNGS,
  classRegistry,
  classTableLines,
  combineClasses,
  environmentClasses,
  registryProblems,
  validateEntry,
} from "../../tools/ext-environment-classes.mjs"

/** A §4.1 the tests own, so the parser and the rule can be driven off known text. */
const FIXTURE = [
  "### 4.1 Environment classes",
  "",
  "| Environment class | Primary purpose | Permitted data | Promotion authority | End state |",
  "|---|---|---|---|---|",
  "| `LOCAL_DEV` | Individual engineering and unit tests | Generated/synthetic only | Developer | Ephemeral |",
  "| `PRODUCTION` | Live tenant operation | Approved production data | Protected production authority | Active/hibernate/offboard |",
  "| `UAT` | Business acceptance | Approved representative, masked, or synthetic data | Business process owners | Frozen evidence baseline |",
  "| `DR_RESTORE_DRILL` | Isolated restore and continuity proof | Encrypted restored data under drill controls | DR owner | Mandatory destruction |",
  "",
  "### 4.2 Environment manifest",
  "",
  "| not | the | class | table | at all |",
].join("\n")

test("§4.1's table is parsed, and every row it holds becomes a class", () => {
  const rows = classTableLines()
  const classes = environmentClasses()
  // rows minus the header and the separator. If the parser silently returned
  // nothing, every assertion below would be vacuously true — this is the guard.
  assert.equal(classes.length, rows.length - 2)
  assert.equal(classes.length, 16, "§4.1 states sixteen classes; a seventeenth needs a rung decided by a person")
  for (const c of classes) {
    for (const f of CLASS_FIELDS) assert.ok(c[f] && c[f].trim() !== "", `${c.id}.${f} is empty`)
  }
  const ids = classes.map((c) => c.id)
  assert.deepEqual(new Set(ids).size, ids.length, "duplicate class id in §4.1")
  for (const expected of ["LOCAL_DEV", "PRODUCTION", "GOLD_PREPRODUCTION", "DR_RESTORE_DRILL", "HYPERCARE_SUPPORT"]) {
    assert.ok(ids.includes(expected), `${expected} missing from the parsed registry`)
  }
})

test("the parse stops at the next heading rather than eating §4.2's tables", () => {
  const classes = environmentClasses(FIXTURE)
  assert.deepEqual(classes.map((c) => c.id), ["LOCAL_DEV", "PRODUCTION", "UAT", "DR_RESTORE_DRILL"])
})

test("a table that stopped being a table fails loudly instead of returning nothing", () => {
  assert.throws(() => environmentClasses("### 4.1 Environment classes\n\nprose, no table\n"), /contains no table/)
  assert.throws(() => environmentClasses("## 9. Something else\n"), /no "### 4.1 Environment classes" heading/)
  const shortRow = FIXTURE.replace("| `UAT` | Business acceptance |", "| `UAT` |")
  assert.throws(() => environmentClasses(shortRow), /cells, expected 5/)
  const notAnId = FIXTURE.replace("| `LOCAL_DEV` |", "| local dev |")
  assert.throws(() => environmentClasses(notAnId), /is not an environment class identifier/)
})

test("every class in §4.1 has a rung on every axis §4.1 supplies, and no rung is orphaned", () => {
  const problems = registryProblems()
  assert.deepEqual(problems, [], `registry problems: ${JSON.stringify(problems, null, 2)}`)
  assert.equal(Object.keys(RUNGS).length, environmentClasses().length)
  for (const entry of classRegistry().values()) {
    assert.ok(DATA_RUNGS.includes(entry.data))
    assert.ok(AUTHORITY_RUNGS.includes(entry.authority))
    assert.ok(DESTRUCTION_RUNGS.includes(entry.destruction))
    assert.ok(entry.why && entry.why.length > 20, `${entry.id} has no recorded reason for its rungs`)
  }
})

test("a rung decided from words the document no longer says is QUOTE_DRIFT, not a silent stale rung", () => {
  const reworded = FIXTURE.replace("Encrypted restored data under drill controls", "Synthetic drill data")
  const problems = registryProblems(reworded)
  const drift = problems.filter((p) => p.kind === "QUOTE_DRIFT")
  assert.equal(drift.length, 1)
  assert.equal(drift[0].id, "DR_RESTORE_DRILL")
  assert.equal(drift[0].field, "permittedData")
  assert.equal(drift[0].actual, "Synthetic drill data")
})

test("a class the document adds and nobody rungs is MISSING_JUDGEMENT", () => {
  const extra = FIXTURE.replace(
    "\n\n### 4.2",
    "\n| `EDGE_CACHE_TEST` | New purpose | Generated/synthetic only | Developer | Ephemeral |\n\n### 4.2",
  )
  const problems = registryProblems(extra)
  assert.ok(problems.some((p) => p.kind === "MISSING_JUDGEMENT" && p.id === "EDGE_CACHE_TEST"))
})

test("a rung for a class §4.1 does not contain is ORPHAN_JUDGEMENT", () => {
  // The fixture has four of the sixteen, so the other twelve are orphaned
  // against it — which is the shape of the failure when a class is deleted.
  const orphans = registryProblems(FIXTURE).filter((p) => p.kind === "ORPHAN_JUDGEMENT").map((p) => p.id)
  assert.equal(orphans.length, 12)
  assert.ok(orphans.includes("GOLD_PREPRODUCTION"))
  assert.ok(!orphans.includes("UAT"))
})

test("the schema rejects an entry missing a field or carrying a rung off its ladder", () => {
  const good = { id: "X", purpose: "p", permittedData: "d", promotionAuthority: "a", endState: "e", data: "SYNTHETIC", authority: "DEVELOPER", destruction: "DESTROYED" }
  assert.deepEqual(validateEntry(good), [])
  assert.deepEqual(validateEntry({ ...good, purpose: "  " }), [{ kind: "MISSING_FIELD", field: "purpose", id: "X" }])
  assert.deepEqual(validateEntry({ ...good, data: "MOSTLY_FINE" }), [{ kind: "UNKNOWN_RUNG", axis: "data", value: "MOSTLY_FINE", id: "X" }])
  const { destruction, ...noDestruction } = good
  assert.deepEqual(validateEntry(noDestruction), [{ kind: "MISSING_RUNG", axis: "destruction", id: "X" }])
})

test("the six combination axes are §4.1's own six, and two of them §4.1 cannot answer", () => {
  assert.deepEqual(AXES.map((a) => a.axis), ["purpose", "data", "access", "release", "evidence", "destruction"])
  assert.deepEqual(AXES_FROM_4_1, ["purpose", "data", "release", "destruction"])
  assert.deepEqual(AXES_NOT_IN_4_1, ["access", "evidence"])
})

test("permitted data is a ceiling: combining takes the minimum, not the maximum", () => {
  const r = combineClasses(["PRODUCTION", "LOCAL_DEV"])
  assert.equal(r.required.data, "SYNTHETIC")
  assert.equal(r.imposedBy.data, "LOCAL_DEV")
  assert.equal(r.ok, false)
  const collapse = r.refusals.find((f) => f.kind === "DATA_CEILING_COLLAPSE")
  assert.equal(collapse.id, "PRODUCTION")
  assert.equal(collapse.needs, "PRODUCTION")
  assert.equal(collapse.ceiling, "SYNTHETIC")
})

test("release and destruction are obligations: combining takes the maximum", () => {
  const r = combineClasses(["LOCAL_DEV", "GOLD_PREPRODUCTION"])
  assert.equal(r.required.release, "BOARD")
  assert.equal(r.imposedBy.release, "GOLD_PREPRODUCTION")
  assert.equal(r.required.destruction, "DESTROYED")
  assert.equal(r.imposedBy.destruction, "LOCAL_DEV")
})

test("a drill environment may not share a home with a frozen evidence baseline", () => {
  const r = combineClasses(["DR_RESTORE_DRILL", "UAT"])
  assert.equal(r.ok, false)
  const conflict = r.refusals.find((f) => f.kind === "DESTRUCTION_CONFLICT")
  assert.equal(conflict.id, "UAT")
  assert.equal(conflict.required, "MANDATORY_DESTRUCTION")
  assert.equal(conflict.imposedBy, "DR_RESTORE_DRILL")
})

test("a combination §4.1 permits comes back permitted, with the strictest value on each axis", () => {
  const r = combineClasses(["SYSTEM_TEST", "TRAINING"])
  assert.equal(r.ok, true)
  assert.deepEqual(r.refusals, [])
  assert.equal(r.required.data, "SYNTHETIC")
  assert.equal(r.required.destruction, "REFRESHED_IN_PLACE")
  assert.equal(r.required.purpose.length, 2)
})

test("access and evidence come back unresolved unless the caller supplies them", () => {
  const bare = combineClasses(["SYSTEM_TEST"])
  assert.deepEqual(bare.unresolvedAxes.map((u) => u.axis), ["access", "evidence"])
  assert.equal(bare.required.access, undefined)
  const supplied = combineClasses(["SYSTEM_TEST"], { access: "QA group, step-up on export", evidence: "cycle exit report" })
  assert.deepEqual(supplied.unresolvedAxes, [])
  assert.equal(supplied.required.access, "QA group, step-up on export")
  assert.equal(supplied.imposedBy.evidence, "SUPPLIED_BY_CALLER")
})

test("a class nobody has heard of, and a combination of nothing, are refused rather than answered", () => {
  const unknown = combineClasses(["SANDBOX"])
  assert.equal(unknown.ok, false)
  assert.deepEqual(unknown.refusals, [{ kind: "UNKNOWN_CLASS", ids: ["SANDBOX"] }])
  assert.equal(combineClasses([]).refusals[0].kind, "NO_CLASS")
})
