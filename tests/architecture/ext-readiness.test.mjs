/**
 * EXT-010-007 — the guard on evidence-derived readiness and the override refusal.
 *
 * Every time comparison takes an explicit `now`. A test that asked the machine
 * what day it was would pass today and fail on the expiry date, which is the
 * one day it most needs to be right.
 */
import assert from "node:assert/strict"
import test from "node:test"

import {
  ACCEPTED_RISK_FIELDS,
  CRITICAL,
  DIMENSIONS,
  STATES,
  acceptedRiskProblems,
  applyOverride,
  assessProgramme,
  averagedReadiness,
  bindingProblems,
  dimensionOf,
  dimensionReadiness,
  evidenceOf,
  programReadiness,
  readinessVocabulary,
  registryIds,
} from "../../tools/ext-readiness.mjs"

test("§11.5's vocabulary is read from the extension, not retyped", () => {
  const v = readinessVocabulary()
  assert.equal(v.dimensions.length, 15, "§11.5 lists fifteen dimensions")
  assert.deepEqual(v.states.sort(), ["BLOCKED_EXTERNAL", "NOT_READY", "READY", "READY_WITH_ACCEPTED_RISK"])
  assert.ok(v.dimensions.includes("security/privacy"))
  assert.ok(v.dimensions.includes("external dependencies"), "the trailing 'and external dependencies' was dropped")
})

test("every critical gate is a dimension the authority names", () => {
  for (const d of Object.keys(CRITICAL)) {
    assert.ok(DIMENSIONS.includes(d), `${d} is not a §11.5 dimension`)
    assert.ok(CRITICAL[d].length > 30, `${d} is called critical with no reason worth reading`)
  }
  assert.ok(Object.keys(CRITICAL).length < DIMENSIONS.length, "if everything is critical nothing is")
})

test("every requirement in the registry binds to exactly one dimension", () => {
  const ids = registryIds()
  assert.ok(ids.length > 2000, `only ${ids.length} ids parsed out of the registry`)
  assert.deepEqual(bindingProblems(ids).map((p) => `${p.kind}: ${p.detail}`), [])
  for (const id of ids) assert.ok(DIMENSIONS.includes(dimensionOf(id)), `${id} → ${dimensionOf(id)}`)
})

const programme = assessProgramme()

test("the assessment accounts for every requirement, once", () => {
  assert.equal(
    Object.values(programme).reduce((n, r) => n + r.size, 0),
    registryIds().length,
  )
  for (const d of DIMENSIONS) assert.ok(d in programme, `${d} was not assessed`)
})

test("evidence-derived differs from status-derived on the real corpus", () => {
  const proven = Object.values(programme).reduce((n, r) => n + r.counts.PROVEN, 0)
  const claimed = Object.values(programme).reduce((n, r) => n + r.counts.CLAIMED, 0)
  // Both halves must be non-zero or the distinction is decorative: all-proven
  // would mean the marker check never fires, all-claimed that it never passes.
  assert.ok(proven > 0, "no row anywhere carries Code, Tests and Evidence — the markers do not match the ledger format")
  assert.ok(claimed > 0, "every PASS row is proven, so the evidence check is not doing anything")
  assert.ok(claimed + proven > 100)
})

test("evidenceOf separates the six outcomes, and NO_ROW is not FAILED", () => {
  const body = "  - Status: PASS\n  - Code: `x.ts` — f()\n  - Caller: y.ts:1\n  - Tests: 3 pass\n  - Evidence: `cmd` → ok"
  assert.equal(evidenceOf("PASS", { body }).outcome, "PROVEN")
  assert.equal(evidenceOf("PASS", { body: "  - Status: PASS\n  - Code: `x.ts`" }).outcome, "CLAIMED")
  assert.deepEqual(evidenceOf("PASS", { body: "  - Status: PASS\n  - Code: `x.ts`" }).missing, ["Tests", "Evidence"])
  assert.equal(evidenceOf("FAIL", { body: "" }).outcome, "FAILED")
  assert.equal(evidenceOf("BLOCKED_EXTERNAL", { body: "" }).outcome, "BLOCKED")
  assert.equal(evidenceOf("NOT_APPLICABLE", { body: "" }).outcome, "EXCLUDED")
  assert.equal(evidenceOf("PASS", null).outcome, "NO_ROW")
  assert.notEqual(evidenceOf("PASS", null).outcome, evidenceOf("FAIL", { body: "" }).outcome)
})

const of = (outcome, n) => Array.from({ length: n }, () => ({ evidence: { outcome, missing: [] } }))

test("a dimension is READY only when nothing is unproven", () => {
  assert.equal(dimensionReadiness([...of("PROVEN", 9), ...of("EXCLUDED", 1)]).state, "READY")
  // One claim without evidence among ninety-nine proofs is still NOT_READY.
  const nearly = dimensionReadiness([...of("PROVEN", 99), ...of("CLAIMED", 1)])
  assert.equal(nearly.state, "NOT_READY")
  assert.equal(nearly.basis, "CLAIMED_WITHOUT_EVIDENCE")
  assert.equal(dimensionReadiness([...of("PROVEN", 5), ...of("BLOCKED", 2)]).state, "BLOCKED_EXTERNAL")
  assert.equal(dimensionReadiness([...of("PROVEN", 5), ...of("BLOCKED", 2), ...of("FAILED", 1)]).state, "NOT_READY")
})

test("a dimension nothing binds to is NOT_READY and says it was never assessed", () => {
  const empty = dimensionReadiness([])
  assert.equal(empty.state, "NOT_READY")
  assert.equal(empty.basis, "NO_EVIDENCE_SOURCE")
  assert.ok(STATES.includes(empty.state), "the basis must not leak a fifth state word into the four §11.5 allows")
})

test("one red critical gate is not averaged away by fourteen green dimensions", () => {
  const states = Object.fromEntries(DIMENSIONS.map((d) => [d, "READY"]))
  states["security/privacy"] = "NOT_READY"
  const p = programReadiness(states)
  assert.equal(p.state, "NOT_READY")
  assert.equal(p.decidedBy, "security/privacy")
  assert.equal(p.critical, true)
  // The forbidden number would have called this ready enough to ship.
  assert.ok(averagedReadiness(states) > 0.9)
})

test("a critical gate outranks a red non-critical one when both are red", () => {
  const states = Object.fromEntries(DIMENSIONS.map((d) => [d, "READY"]))
  states.training = "NOT_READY"
  states.cutover = "BLOCKED_EXTERNAL"
  const p = programReadiness(states)
  assert.equal(p.decidedBy, "cutover")
  assert.equal(p.state, "BLOCKED_EXTERNAL")
})

// ── the refusals ─────────────────────────────────────────────────────────────

const NOW = new Date("2026-08-17T00:00:00Z")
const red = { state: "NOT_READY", why: "234 failed" }
const goodRisk = {
  authority: "Programme board",
  rationale: "the remaining scope is reporting-only",
  compensatingControl: "manual reconciliation each Friday",
  expiry: "2026-12-31",
  owner: "Head of Delivery",
  contingency: "revert to the legacy report",
}

test("MANUAL_GREEN is refused, whoever asks", () => {
  const r = applyOverride("integrations", red, { to: "READY", actor: "the CTO" }, NOW)
  assert.equal(r.applied, false)
  assert.equal(r.refusal, "MANUAL_GREEN")
  assert.match(r.why, /the CTO/)
  // Critical or not makes no difference to this one; §3.4 admits no exception.
  assert.equal(applyOverride("security/privacy", red, { to: "READY", actor: "anyone" }, NOW).refusal, "MANUAL_GREEN")
})

test("an override with no actor, or an invented state, is refused", () => {
  assert.equal(applyOverride("integrations", red, { to: "READY_WITH_ACCEPTED_RISK", acceptedRisk: goodRisk }, NOW).refusal, "NO_ACTOR")
  assert.equal(applyOverride("integrations", red, { to: "GREEN_ENOUGH", actor: "x" }, NOW).refusal, "UNKNOWN_STATE")
  assert.equal(applyOverride("integrations", red, { to: "AMBER", actor: "x" }, NOW).refusal, "UNKNOWN_STATE")
})

test("an accepted risk missing any of §11.5's six fields is refused, and the field is named", () => {
  for (const field of ACCEPTED_RISK_FIELDS) {
    const risk = { ...goodRisk, [field]: "" }
    const r = applyOverride("integrations", red, { to: "READY_WITH_ACCEPTED_RISK", actor: "x", acceptedRisk: risk }, NOW)
    assert.equal(r.applied, false, `${field} omitted and the override was applied`)
    assert.equal(r.refusal, "INCOMPLETE_ACCEPTED_RISK")
    assert.match(r.why, new RegExp(`missing ${field}`))
  }
  assert.deepEqual(acceptedRiskProblems(goodRisk, NOW), [])
})

test("an expired acceptance is refused, and expiry is compared against a stated instant", () => {
  const expired = { ...goodRisk, expiry: "2026-01-01" }
  const r = applyOverride("integrations", red, { to: "READY_WITH_ACCEPTED_RISK", actor: "x", acceptedRisk: expired }, NOW)
  assert.equal(r.refusal, "INCOMPLETE_ACCEPTED_RISK")
  assert.match(r.why, /expired 2026-01-01/)
  // The same record before its expiry is fine, which is what makes the refusal
  // about the date rather than about the record.
  assert.equal(applyOverride("integrations", red, { to: "READY_WITH_ACCEPTED_RISK", actor: "x", acceptedRisk: expired }, new Date("2025-06-01")).applied, true)
  assert.deepEqual(acceptedRiskProblems({ ...goodRisk, expiry: "not a date" }, NOW), ["expiry is not a date"])
})

test("a blanket risk acceptance cannot lift a critical gate — it has to name it", () => {
  const blanket = applyOverride("data/migration", red, { to: "READY_WITH_ACCEPTED_RISK", actor: "board", acceptedRisk: goodRisk }, NOW)
  assert.equal(blanket.applied, false)
  assert.equal(blanket.refusal, "RISK_DOES_NOT_NAME_GATE")
  assert.match(blanket.why, /critical gate/)

  const named = applyOverride(
    "data/migration",
    red,
    { to: "READY_WITH_ACCEPTED_RISK", actor: "board", acceptedRisk: { ...goodRisk, gate: "data/migration" } },
    NOW,
  )
  assert.deepEqual(named, { applied: true, state: "READY_WITH_ACCEPTED_RISK", by: "board" })

  // A non-critical gate takes an unnamed acceptance, which is what makes the
  // clause above about criticality and not about the field being required.
  assert.equal(applyOverride("training", red, { to: "READY_WITH_ACCEPTED_RISK", actor: "board", acceptedRisk: goodRisk }, NOW).applied, true)
})

test("downgrades are allowed, and an override never mutates the state it was given", () => {
  const before = JSON.parse(JSON.stringify(red))
  assert.equal(applyOverride("cutover", { state: "READY", why: "all proven" }, { to: "NOT_READY", actor: "x" }, NOW).state, "NOT_READY")
  assert.equal(applyOverride("cutover", red, { to: "BLOCKED_EXTERNAL", actor: "x" }, NOW).applied, true)
  applyOverride("cutover", red, { to: "READY", actor: "x" }, NOW)
  assert.deepEqual(red, before)
})

test("an override that agrees with the evidence is not an override", () => {
  const green = { state: "READY", why: "all proven" }
  const r = applyOverride("training", green, { to: "READY_WITH_ACCEPTED_RISK", actor: "x", acceptedRisk: goodRisk }, NOW)
  assert.equal(r.refusal, "NOTHING_TO_OVERRIDE")
})
