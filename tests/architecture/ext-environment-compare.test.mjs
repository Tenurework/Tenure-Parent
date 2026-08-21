/**
 * EXT-020-007 — the compare covers the requirement's nine axes, reports the one
 * §4.2 cannot answer as unanswerable rather than omitting it, and never turns
 * an unknown into a difference.
 */
import assert from "node:assert/strict"
import test from "node:test"

import {
  AXES,
  AXES_WITHOUT_FIELD,
  OUTCOMES,
  compareAxis,
  compareEnvironments,
  compareLandscape,
  compareProblems,
  manifestsById,
  unnamedVersionFields,
} from "../../tools/ext-environment-compare.mjs"
import { landscape, manifestSchema } from "../../tools/ext-environment-manifest.mjs"

const schema = manifestSchema()

/** A pair of manifests the test owns, so an outcome can be driven to each of the four. */
function pair(aOverrides = {}, bOverrides = {}) {
  const base = (id) => {
    const m = { immutableEnvironmentId: id, class: "SYSTEM_TEST", unknown: {} }
    for (const f of schema) if (f.key !== "immutableEnvironmentId" && f.key !== "class") m[f.key] = `${f.key}@1`
    return m
  }
  return [{ ...base("a"), ...aOverrides }, { ...base("b"), ...bOverrides }]
}

test("the nine axes are the requirement's own nine, in its order", () => {
  assert.deepEqual(
    AXES.map((a) => a.axis),
    ["release", "IaC", "schema", "config", "mappings", "packs", "connectors", "dataClass", "relay"],
  )
  assert.deepEqual(compareProblems(schema), [])
})

test("every axis that binds a field binds one §4.2 actually has", () => {
  const keys = new Set(schema.map((f) => f.key))
  for (const a of AXES) {
    if (a.field === null) continue
    assert.ok(keys.has(a.field), `${a.axis} binds ${a.field}, which §4.2 does not supply`)
  }
  const broken = compareProblems(schema.filter((f) => f.key !== "connectorVersions"))
  assert.deepEqual(broken, [{ kind: "AXIS_BINDS_MISSING_FIELD", axis: "connectors", field: "connectorVersions" }])
})

test("the one axis §4.2 supplies no field for is named, not silently dropped", () => {
  assert.deepEqual(AXES_WITHOUT_FIELD, ["mappings"])
  const [a, b] = pair()
  const r = compareAxis("mappings", a, b)
  assert.equal(r.outcome, "NO_FIELD")
  assert.match(r.why, /§4.2's field list names no mapping version/)
})

test("schema and config read one field, and the compare says they share it", () => {
  const s = AXES.find((a) => a.axis === "schema")
  const c = AXES.find((a) => a.axis === "config")
  assert.equal(s.field, c.field)
  assert.equal(s.sharedWith, "config")
  assert.equal(c.sharedWith, "schema")
  const [a, b] = pair({ databaseConfigSchemaVersions: "v9" })
  assert.equal(compareAxis("schema", a, b).outcome, compareAxis("config", a, b).outcome)
})

test("a version field the requirement does not name is reported rather than compared", () => {
  assert.deepEqual(unnamedVersionFields(schema), ["fixtureVersion"])
})

test("same is same, different is different", () => {
  const [a, b] = pair()
  assert.equal(compareAxis("relay", a, b).outcome, "SAME")
  const [c, d] = pair({}, { relayModelPromptToolEvaluationVersions: "relay@2" })
  const r = compareAxis("relay", c, d)
  assert.equal(r.outcome, "DIFFERENT")
  assert.equal(r.a, "relayModelPromptToolEvaluationVersions@1")
  assert.equal(r.b, "relay@2")
})

test("an unknown on either side is UNCOMPARABLE, carrying the reason — never a difference", () => {
  const [a, b] = pair({ iacVersion: null, unknown: { iacVersion: "nobody has recorded it" } })
  const r = compareAxis("IaC", a, b)
  assert.equal(r.outcome, "UNCOMPARABLE")
  assert.match(r.why, /a: nobody has recorded it/)
  const [c, d] = pair({ iacVersion: null, unknown: { iacVersion: "x" } }, { iacVersion: null, unknown: { iacVersion: "y" } })
  assert.equal(compareAxis("IaC", c, d).outcome, "UNCOMPARABLE")
})

test("a null with no stated reason is still UNCOMPARABLE, and says the reason is missing", () => {
  const [a, b] = pair({ iacVersion: null })
  const r = compareAxis("IaC", a, b)
  assert.equal(r.outcome, "UNCOMPARABLE")
  assert.match(r.why, /null with no stated reason/)
})

test("a manifest that never carried the field is UNCOMPARABLE, distinct from one that answered null", () => {
  const [a, b] = pair()
  delete a.connectorVersions
  const r = compareAxis("connectors", a, b)
  assert.equal(r.outcome, "UNCOMPARABLE")
  assert.match(r.why, /carries no connectorVersions; the manifest was never asked/)
})

test("an axis nobody defined is refused rather than answered", () => {
  const [a, b] = pair()
  assert.throws(() => compareAxis("vibes", a, b), /not one of EXT-020-007's nine axes/)
})

test("the comparable count is the honest denominator", () => {
  const land = landscape()
  const r = compareEnvironments("local-dev", "tenure-pilot-production", land)
  assert.equal(r.ok, true)
  assert.equal(r.axes.length, 9)
  assert.equal(r.counts.SAME + r.counts.DIFFERENT + r.counts.UNCOMPARABLE + r.counts.NO_FIELD, 9)
  assert.equal(r.comparable, r.counts.SAME + r.counts.DIFFERENT)
  assert.ok(r.counts.NO_FIELD >= 1, "mappings is unanswerable for every pair")
  // The one thing this repository DOES know about that pair: their data class.
  const dataClass = r.axes.find((x) => x.axis === "dataClass")
  assert.equal(dataClass.outcome, "DIFFERENT")
  assert.equal(dataClass.a, "SYNTHETIC")
  assert.equal(dataClass.b, "PRODUCTION")
  for (const x of r.axes) assert.ok(OUTCOMES.includes(x.outcome))
})

test("an environment nobody declared is refused, not compared against nothing", () => {
  const r = compareEnvironments("local-dev", "staging", landscape())
  assert.equal(r.ok, false)
  assert.deepEqual(r.error, { kind: "UNKNOWN_ENVIRONMENT", ids: ["staging"] })
})

test("the landscape view holds every pair of the declared environments", () => {
  const land = landscape()
  const { ids, pairs } = compareLandscape(land)
  const n = land.manifests.length
  assert.equal(ids.length, n)
  assert.equal(pairs.length, (n * (n - 1)) / 2)
  for (const p of pairs) assert.equal(p.ok, true)
  assert.equal(manifestsById(land).size, n)
})
