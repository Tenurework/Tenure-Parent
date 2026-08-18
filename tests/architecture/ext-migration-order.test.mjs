/**
 * EXT-060-006 — the guard on the migration wave planner.
 *
 * The corpus half runs the planner over this product's real schema and asserts
 * properties, not numbers: every migrated model appears exactly once, every
 * required foreign key loads after its target, every batch is within the bound,
 * every model is classified. A model count is data and would go stale; "every
 * required edge points backwards" is the invariant and cannot.
 *
 * The fixture half drives the refusals on hand-built schemas, because the real
 * schema is — correctly — free of all of them. A refusal that has never been
 * seen to fire is a refusal nobody has proven exists.
 */
import assert from "node:assert/strict"
import test from "node:test"

import {
  CLASSIFICATION,
  declaredEdges,
  deferredReferences,
  layerOf,
  layers,
  migrated,
  parseSchema,
  planWaves,
  preconditionProblems,
  requiredCycles,
  sequenceProblems,
  undeclaredReferences,
  waveIndex,
} from "../../tools/ext-migration-order.mjs"

const models = parseSchema()
const edges = declaredEdges(models)
const plan = planWaves(models, { maxParallel: 4, edges })

test("§8.6's layers are read from the extension, all seven of them", () => {
  const l = layers()
  assert.equal(l.length, 7, "the extension states seven dependency layers")
  assert.deepEqual(l.map((x) => x.layer), [1, 2, 3, 4, 5, 6, 7])
  assert.match(l[0].description, /Tenant configuration/)
  assert.match(l[6].description, /Delta changes/)
})

test("the schema parse found models and foreign keys, and did not read a back-reference as one", () => {
  assert.ok(models.size >= 40, `only ${models.size} models parsed`)
  assert.ok(edges.length >= 60, `only ${edges.length} declared foreign keys parsed`)
  // `ApprovalRequest.conversation` is the far end of Conversation's key: it has
  // no `fields:`, so it must not appear as an edge, or the graph gains a cycle
  // that does not exist and no order is possible.
  assert.equal(edges.filter((e) => e.from === "ApprovalRequest" && e.field === "conversation").length, 0)
  assert.equal(edges.filter((e) => e.from === "Conversation" && e.field === "approval").length, 1)
  // Required and optional are read off the schema, not assumed. Collapsing them
  // makes every refusal below vacuous — a graph of all-optional edges can be
  // loaded in any order at all and the planner would never object to anything.
  assert.equal(edges.find((e) => e.from === "Organization" && e.field === "institution").required, true)
  assert.equal(edges.find((e) => e.from === "Resource" && e.field === "createdBy").required, false)
  assert.ok(edges.some((e) => e.required) && edges.some((e) => !e.required))
})

test("every model in the schema is classified, and no classification names a model that is gone", () => {
  const unclassified = [...models.keys()].filter((m) => !(m in CLASSIFICATION))
  assert.deepEqual(unclassified, [])
  const gone = Object.keys(CLASSIFICATION).filter((m) => !models.has(m))
  assert.deepEqual(gone, [])
})

test("a model that is not migrated says why, and that is not the same as being unclassified", () => {
  const notMigrated = [...models.keys()].filter((m) => !migrated(m))
  assert.ok(notMigrated.length > 0)
  for (const m of notMigrated) {
    assert.equal(layerOf(m), null, `${m} should be null, not ${layerOf(m)}`)
    assert.ok(CLASSIFICATION[m][1].length > 30, `${m} is not migrated with no reason worth reading`)
  }
  assert.equal(layerOf("NoSuchModel"), undefined)
})

test("preconditions are clean on the real schema", () => {
  assert.deepEqual(preconditionProblems(models, edges).map((p) => `${p.kind}: ${p.detail}`), [])
})

test("the required subgraph is acyclic, and the optional cycles that do exist are not counted", () => {
  assert.deepEqual(requiredCycles(models, edges), [])
  // LedgerEntry.reverses pointing at LedgerEntry is a real cycle in the full
  // graph, and a legal one: the key is nullable, so a second pass can set it.
  const optional = edges.filter((e) => !e.required)
  assert.ok(optional.some((e) => e.from === "Event" && e.to === "ApprovalRequest"))
  assert.ok(optional.some((e) => e.from === "LedgerEntry" && e.to === "LedgerEntry"), "the self-reversal edge is missing")
})

test("the plan covers every migrated model exactly once", () => {
  const scheduled = plan.flatMap((w) => w.models)
  const expected = [...models.keys()].filter(migrated).sort()
  assert.deepEqual([...scheduled].sort(), expected)
  assert.equal(new Set(scheduled).size, scheduled.length, "a model is scheduled twice")
})

test("no required foreign key loads before its target — the orphan refusal, on the real graph", () => {
  assert.deepEqual(sequenceProblems(plan, edges).map((p) => p.detail), [])
})

test("waves never run backwards through §8.6's layers", () => {
  const seen = plan.map((w) => w.layer)
  assert.deepEqual(seen, [...seen].sort((a, b) => a - b))
  const at = waveIndex(plan)
  for (const m of at.keys()) assert.equal(plan[at.get(m) - 1].layer, layerOf(m))
})

test("parallelism is bounded by the argument, and the bound is what changes the batching", () => {
  for (const max of [1, 3, 4, 25]) {
    const p = planWaves(models, { maxParallel: max, edges })
    for (const w of p) for (const b of w.batches) assert.ok(b.length <= max, `batch of ${b.length} exceeds ${max}`)
    assert.deepEqual(p.map((w) => w.models), plan.map((w) => w.models), "the bound changed the wave contents, not just the batching")
  }
  const one = planWaves(models, { maxParallel: 1, edges })
  assert.ok(
    one.reduce((n, w) => n + w.batches.length, 0) > plan.reduce((n, w) => n + w.batches.length, 0),
    "maxParallel: 1 produced no more batches than maxParallel: 4",
  )
})

test("every deferred reference is optional, forward, and named — nothing is silently left dangling", () => {
  const deferred = deferredReferences(plan, edges)
  const at = waveIndex(plan)
  assert.ok(deferred.length > 0, "the real schema has forward optional references; finding none means the scan is broken")
  for (const d of deferred) {
    const edge = edges.find((e) => e.from === d.from && e.field === d.field)
    assert.ok(edge, `${d.from}.${d.field} is not an edge`)
    assert.equal(edge.required, false, `${d.from}.${d.field} is required and was reported as deferrable`)
    assert.ok(at.get(d.to) >= at.get(d.from), `${d.from}.${d.field} target loads earlier and needs no second pass`)
  }
  // Every optional edge is either satisfied by the order or on this list. There
  // is no third bucket, and a third bucket is what unauditable orphaned data is.
  const optionalForward = edges.filter((e) => !e.required && migrated(e.from) && migrated(e.to) && at.get(e.to) >= at.get(e.from))
  assert.equal(deferred.length, optionalForward.length)
})

test("undeclared references are classified, and the planner does not resolve them by name", () => {
  const u = undeclaredReferences(models)
  assert.ok(u.length > 0)
  for (const x of u) assert.ok(["INFERRED", "UNRESOLVED"].includes(x.basis))
  // institutionId: 20-odd models declare it and six do not. Same field, one target.
  const inst = u.find((x) => x.model === "ConflictDeclaration" && x.field === "institutionId")
  assert.equal(inst.basis, "INFERRED")
  assert.equal(inst.target, "Institution")
  // accountId on a provider receipt name-matches the NextAuth `Account` model
  // and is a provider-side identifier. Nothing declares it, so nothing resolves it.
  const acct = u.find((x) => x.model === "ProviderEventReceipt" && x.field === "accountId")
  assert.equal(acct.basis, "UNRESOLVED")
  assert.equal(acct.target, null)
  // `Resource` is a real model, so a name-matching resolver would bind this —
  // but Recusal carries resourceType, whose own default is `ApprovalRequest`.
  const poly = u.find((x) => x.model === "Recusal" && x.field === "resourceId")
  assert.equal(poly.basis, "UNRESOLVED")
  assert.match(poly.why, /polymorphic/)
  // No undeclared reference is ever an ordering edge.
  for (const x of u) assert.equal(edges.some((e) => e.from === x.model && e.field === x.field), false)
})

// ── the refusals, on schemas built to trigger them ───────────────────────────

const schema = (body) => parseSchema(body)

test("REQUIRED_CYCLE fires when two models require each other", () => {
  const s = schema(
    "model Institution {\n  id String @id\n  aId String\n  a Deliverable @relation(fields: [aId], references: [id])\n}\n" +
      "model Deliverable {\n  id String @id\n  bId String\n  b Institution @relation(fields: [bId], references: [id])\n}\n",
  )
  const e = declaredEdges(s)
  assert.equal(requiredCycles(s, e).length, 1)
  assert.deepEqual(
    preconditionProblems(s, e, layers(), { wholeSchema: false }).map((p) => p.kind),
    ["REQUIRED_CYCLE"],
  )
})

test("an optional cycle is not a REQUIRED_CYCLE", () => {
  const s = schema(
    "model Institution {\n  id String @id\n  aId String?\n  a Deliverable? @relation(fields: [aId], references: [id])\n}\n" +
      "model Deliverable {\n  id String @id\n  bId String?\n  b Institution? @relation(fields: [bId], references: [id])\n}\n",
  )
  assert.deepEqual(requiredCycles(s, declaredEdges(s)), [])
})

test("LAYER_INVERSION fires when a required dependency sits in a later layer", () => {
  // Institution is layer 1 and User is layer 3, so this edge points forwards.
  const s = schema("model Institution {\n  id String @id\n  uId String\n  u User @relation(fields: [uId], references: [id])\n}\nmodel User {\n  id String @id\n}\n")
  const p = preconditionProblems(s, declaredEdges(s), layers(), { wholeSchema: false })
  assert.deepEqual(p.map((x) => x.kind), ["LAYER_INVERSION"])
  assert.match(p[0].detail, /Institution \(layer 1\) requires User \(layer 3\)/)
})

test("DEPENDS_ON_NOT_MIGRATED fires when live data would need something the plan deliberately drops", () => {
  const s = schema("model Institution {\n  id String @id\n  sId String\n  s Session @relation(fields: [sId], references: [id])\n}\nmodel Session {\n  id String @id\n}\n")
  const p = preconditionProblems(s, declaredEdges(s), layers(), { wholeSchema: false })
  assert.deepEqual(p.map((x) => x.kind), ["DEPENDS_ON_NOT_MIGRATED"])
})

test("UNCLASSIFIED_MODEL fires on a model nobody put in a layer", () => {
  const s = schema("model Institution {\n  id String @id\n}\nmodel Sprocket {\n  id String @id\n}\n")
  const p = preconditionProblems(s, declaredEdges(s), layers(), { wholeSchema: false })
  assert.deepEqual(p.map((x) => x.kind), ["UNCLASSIFIED_MODEL"])
  assert.match(p[0].detail, /Sprocket/)
})

test("ORPHANED_REQUIRED_REFERENCE is what a plan that loads a child first looks like", () => {
  // A plan asserted by hand, not produced by the planner: the refusal has to
  // hold against any sequence, including one nothing in this file generated.
  const s = schema("model Institution {\n  id String @id\n}\nmodel Organization {\n  id String @id\n  iId String\n  i Institution @relation(fields: [iId], references: [id])\n}\n")
  const e = declaredEdges(s)
  const wrong = [
    { wave: 1, layer: 2, models: ["Organization"], batches: [["Organization"]] },
    { wave: 2, layer: 1, models: ["Institution"], batches: [["Institution"]] },
  ]
  const p = sequenceProblems(wrong, e)
  assert.deepEqual(p.map((x) => x.kind), ["ORPHANED_REQUIRED_REFERENCE"])
  assert.match(p[0].detail, /Institution loads in wave 2, Organization in wave 1/)

  // Same wave is also orphaning, and is the case a `>` instead of a `>=` lets
  // through: a batch that loads parent and child concurrently has no ordering
  // between them at all, so the child may still be written first.
  const together = [{ wave: 1, layer: 1, models: ["Institution", "Organization"], batches: [["Institution", "Organization"]] }]
  assert.deepEqual(sequenceProblems(together, e).map((x) => x.kind), ["ORPHANED_REQUIRED_REFERENCE"])

  assert.deepEqual(sequenceProblems(planWaves(s, { edges: e }), e), [])
})
