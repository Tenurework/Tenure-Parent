/**
 * EXT-020-002 — the manifest field contract is §4.2's, the nine groups the
 * requirement names all have fields, this repository's five environments are
 * declared through it, and the validator refuses the ways a manifest can lie.
 */
import assert from "node:assert/strict"
import test from "node:test"

import { classRegistry } from "../../tools/ext-environment-classes.mjs"
import {
  GROUPS,
  GROUP_NAMES,
  fieldKey,
  fieldPhrases,
  githubEnvironments,
  landscape,
  landscapeProblems,
  manifestBullets,
  manifestSchema,
  validateManifest,
} from "../../tools/ext-environment-manifest.mjs"

const schema = manifestSchema()
const registry = classRegistry()

/** A manifest that is valid, built from the schema, so the negatives below change exactly one thing. */
function validManifest(overrides = {}) {
  const m = { immutableEnvironmentId: "fixture", class: "LOCAL_DEV", unknown: {} }
  for (const f of schema) {
    if (f.key === "immutableEnvironmentId" || f.key === "class") continue
    m[f.key] = f.key === "allowedDataClassifications" ? "SYNTHETIC" : `value for ${f.phrase}`
  }
  return { ...m, ...overrides }
}

test("§4.2's bullets are all bound, and each binding still quotes the document verbatim", () => {
  const bullets = manifestBullets()
  assert.equal(bullets.length, 8, "§4.2 lists eight bullets")
  assert.equal(GROUPS.length, bullets.length)
  for (const g of GROUPS) assert.equal(bullets[g.bullet], g.quote)
  assert.deepEqual(GROUPS.map((g) => g.bullet), [0, 1, 2, 3, 4, 5, 6, 7])
})

test("a reworded bullet fails the schema rather than rebinding a group silently", () => {
  const bullets = manifestBullets()
  const reworded = bullets.map((b, i) => (i === 2 ? "Allowed data classifications and whatever else." : b))
  const text = ["### 4.2 Environment manifest", "", ...reworded.map((b) => `- ${b}`), "", "### 4.3 next"].join("\n")
  assert.throws(() => manifestSchema(text), /bullet 2 is no longer/)
})

test("a §4.2 with a bullet nobody bound is refused, not partially read", () => {
  const text = ["### 4.2 Environment manifest", "", ...manifestBullets().map((b) => `- ${b}`), "- A ninth thing.", "", "### 4.3 next"].join("\n")
  assert.throws(() => manifestSchema(text), /9 bullets, 8 bound/)
  assert.throws(() => manifestSchema("### 4.2 Environment manifest\n\nprose\n\n### 4.3 next\n"), /lists no fields/)
})

test("every one of the requirement's nine groups has at least one field", () => {
  const byGroup = new Map()
  for (const f of schema) byGroup.set(f.group, (byGroup.get(f.group) ?? 0) + 1)
  assert.deepEqual([...byGroup.keys()].sort(), [...GROUP_NAMES].sort())
  for (const g of GROUP_NAMES) assert.ok(byGroup.get(g) >= 1, `group ${g} has no field — the requirement names it`)
  // expiry and destruction only exist because `claims` moves them out of the
  // bullet they share. Without that they would be zero and this requirement
  // would be answered for seven of its nine groups.
  assert.equal(byGroup.get("expiry"), 1)
  assert.equal(byGroup.get("destruction"), 5)
})

test("field keys are derived from the document's phrases, deterministically", () => {
  assert.equal(fieldKey("AWS partition/account/region/cell"), "awsPartitionAccountRegionCell")
  assert.equal(fieldKey("Relay model/prompt/tool/evaluation versions"), "relayModelPromptToolEvaluationVersions")
  assert.equal(fieldKey("step-up requirements"), "stepUpRequirements")
  assert.throws(() => fieldKey("  "), /no field key can be made/)
  const keys = schema.map((f) => f.key)
  assert.equal(new Set(keys).size, keys.length, "two fields slug to one key")
})

test("the comma split is exercised on the document's own bullets, not trusted", () => {
  const bullets = manifestBullets()
  assert.deepEqual(fieldPhrases(bullets[2]), ["Allowed data classifications", "explicit prohibited data"])
  assert.equal(fieldPhrases(bullets[0]).length, 7)
  assert.equal(fieldPhrases(bullets[0]).at(-1), "expiry")
  // Bullet 5 is why the override exists: the plain split invents fields.
  assert.equal(fieldPhrases(bullets[5]).length, 4)
  assert.equal(schema.filter((f) => f.bullet === 5).length, 2)
})

test("the landscape declares this repository's environments and every one validates", () => {
  const land = landscape()
  assert.ok(land.manifests.length >= 5)
  const problems = landscapeProblems(land, schema, registry)
  assert.deepEqual(problems, [], `landscape problems: ${JSON.stringify(problems, null, 2)}`)
  for (const m of land.manifests) {
    assert.ok(registry.has(m.class), `${m.immutableEnvironmentId} names a class §4.1 does not define`)
    for (const f of schema) assert.ok(Object.prototype.hasOwnProperty.call(m, f.key), `${m.immutableEnvironmentId} is missing ${f.key}`)
  }
})

test("every GitHub environment the OIDC declaration names is claimed by a manifest", () => {
  const declared = githubEnvironments()
  assert.ok(declared.length >= 2)
  const claimed = landscape().manifests.map((m) => m.githubEnvironment).filter(Boolean)
  for (const name of declared) assert.ok(claimed.includes(name), `${name} has no manifest`)
})

test("an undeclared GitHub environment, and a declared one nobody claims, are both problems", () => {
  const land = landscape()
  const invented = {
    ...land,
    manifests: land.manifests.map((m) => (m.githubEnvironment === "aws-read" ? { ...m, githubEnvironment: "aws-write" } : m)),
  }
  const kinds = landscapeProblems(invented, schema, registry).map((p) => p.kind)
  assert.ok(kinds.includes("GITHUB_ENVIRONMENT_WITHOUT_MANIFEST"))
  assert.ok(kinds.includes("MANIFEST_NAMES_UNDECLARED_ENVIRONMENT"))
})

test("a production manifest whose workflow lost its repository guard is caught", () => {
  const land = landscape()
  const pilot = land.manifests.find((m) => m.immutableEnvironmentId === "tenure-pilot-production")
  assert.equal(pilot.productionGuard, "github.repository == 'Tenurework/Tenure'")
  const moved = { ...land, manifests: land.manifests.map((m) => (m === pilot ? { ...m, productionGuard: "github.repository == 'Somebody/Else'" } : m)) }
  const p = landscapeProblems(moved, schema, registry).filter((x) => x.kind === "PRODUCTION_GUARD_MISSING")
  assert.equal(p.length, 1)
  assert.equal(p[0].workflow, "deploy.yml")
  const ungarded = { ...land, manifests: land.manifests.map((m) => (m === pilot ? { ...m, productionGuard: null } : m)) }
  assert.ok(landscapeProblems(ungarded, schema, registry).some((x) => x.kind === "PRODUCTION_WITHOUT_GUARD"))
})

test("a provisioning workflow that does not exist is a problem, not a shrug", () => {
  const land = landscape()
  const bent = { ...land, manifests: land.manifests.map((m, i) => (i === 0 ? { ...m, provisioningWorkflows: ["never-written.yml"] } : m)) }
  const p = landscapeProblems(bent, schema, registry).filter((x) => x.kind === "PROVISIONING_WORKFLOW_MISSING")
  assert.deepEqual(p, [{ kind: "PROVISIONING_WORKFLOW_MISSING", id: "local-dev", workflow: "never-written.yml" }])
})

test("an absent field and a null one are different failures, and a null needs a reason", () => {
  assert.deepEqual(validateManifest(validManifest(), schema, registry), [])

  const { costBudget, ...absent } = validManifest()
  const p1 = validateManifest(absent, schema, registry)
  assert.deepEqual(p1, [{ kind: "MISSING_FIELD", id: "fixture", key: "costBudget", phrase: "Cost budget", group: "cost" }])

  const p2 = validateManifest(validManifest({ costBudget: null }), schema, registry)
  assert.deepEqual(p2, [{ kind: "UNSTATED_UNKNOWN", id: "fixture", key: "costBudget", phrase: "Cost budget" }])

  const stated = validateManifest(validManifest({ costBudget: null, unknown: { costBudget: "nobody has set one" } }), schema, registry)
  assert.deepEqual(stated, [])
})

test("a reason for a field that is answered, or for a field §4.2 never named, is stale and says so", () => {
  const answered = validateManifest(validManifest({ unknown: { costBudget: "stale" } }), schema, registry)
  assert.deepEqual(answered, [{ kind: "UNKNOWN_BUT_ANSWERED", id: "fixture", key: "costBudget" }])
  const invented = validateManifest(validManifest({ unknown: { favouriteColour: "blue" } }), schema, registry)
  assert.deepEqual(invented, [{ kind: "UNKNOWN_WITHOUT_FIELD", id: "fixture", key: "favouriteColour" }])
})

test("a manifest may not claim data its own §4.1 class is not permitted to hold", () => {
  const over = validateManifest(validManifest({ allowedDataClassifications: "PRODUCTION" }), schema, registry)
  assert.deepEqual(over, [{ kind: "DATA_ABOVE_CEILING", id: "fixture", claimed: "PRODUCTION", ceiling: "SYNTHETIC", class: "LOCAL_DEV" }])
  const nonsense = validateManifest(validManifest({ allowedDataClassifications: "QUITE_SENSITIVE" }), schema, registry)
  assert.deepEqual(nonsense, [{ kind: "UNKNOWN_DATA_RUNG", id: "fixture", claimed: "QUITE_SENSITIVE" }])
  const noClass = validateManifest(validManifest({ class: "SANDBOX" }), schema, registry)
  assert.deepEqual(noClass, [{ kind: "UNKNOWN_CLASS", id: "fixture", class: "SANDBOX" }])
})

test("two manifests may not share an immutable environment ID", () => {
  const land = landscape()
  const doubled = { ...land, manifests: [...land.manifests, land.manifests[0]] }
  assert.ok(landscapeProblems(doubled, schema, registry).some((p) => p.kind === "DUPLICATE_ENVIRONMENT_ID"))
})

test("the landscape states what it does not know, per field, rather than leaving it blank", () => {
  for (const m of landscape().manifests) {
    const nulls = schema.filter((f) => m[f.key] === null).map((f) => f.key)
    for (const key of nulls) {
      assert.ok(m.unknown?.[key], `${m.immutableEnvironmentId}.${key} is null with no stated reason`)
      assert.ok(m.unknown[key].length > 20, `${m.immutableEnvironmentId}.${key}'s reason is too short to be one`)
    }
  }
})
