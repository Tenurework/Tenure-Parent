import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"

import {
  CARDINALITY_MODES,
  COUNT_DIMENSIONS,
  COUNT_KINDS,
  DETECTIONS,
  DETECTIONS_DEFERRED,
  cardinalityVerdict,
} from "../../packages/provisioning/src/connection-cardinality.mjs"

/**
 * CAT-010-001 — the engine's vocabulary IS the Bible's, read from the Bible.
 *
 * "Implement all cardinality modes and count dimensions" is only checkable if
 * "all" is a fact about §1.1 rather than a list somebody transcribed once and
 * nobody re-read. So this parses the Bible's own bullets and asserts set
 * equality in BOTH directions: a mode dropped from the engine reds, and a mode
 * the engine invented reds too.
 *
 * The same shape closed CAT-000-003 for the sixteen lifecycle states, and it is
 * used here for the same reason — a constant that agrees with a document only on
 * the day it was written is a constant nobody is checking.
 *
 * §4.2 gets the same treatment across two lists. `DETECTIONS` is what the engine
 * decides and `DETECTIONS_DEFERRED` is what it refuses to; together they must be
 * exactly §4.2's fourteen bullets. That is the guard against the failure mode
 * that matters here: quietly implementing nine of fourteen and calling the
 * detector list complete.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, "../..")
const BIBLE =
  "Tenure_Global_Deployer_Integration_Catalog_and_Tenant_Connection_Composer_Claude_Bible_v1.0.md"

const bible = fs.readFileSync(path.join(ROOT, BIBLE), "utf8")

/** The text between two anchors, exclusive. Throws rather than returning "". */
function between(startAnchor, endAnchor) {
  const from = bible.indexOf(startAnchor)
  assert.notEqual(from, -1, `${BIBLE} no longer contains "${startAnchor}"; this guard reads it.`)
  const after = from + startAnchor.length
  const to = bible.indexOf(endAnchor, after)
  assert.notEqual(to, -1, `${BIBLE} no longer contains "${endAnchor}" after "${startAnchor}".`)
  return bible.slice(after, to)
}

/** §1.1's fourteen backticked mode names, in the Bible's order. */
function bibleModes() {
  const block = between("### 1.1 Cardinality modes", "Count dimensions include:")
  return [...block.matchAll(/^- `([A-Z_]+)`$/gm)].map((m) => m[1])
}

/** §1.1's count-dimension bullets, trailing `;`/`.` stripped. */
function bibleDimensions() {
  const block = between("Count dimensions include:", "The Deployer distinguishes:")
  return [...block.matchAll(/^- (.+?)[;.]$/gm)].map((m) => m[1])
}

/** §1's five-way distinction: `N. **Name** — definition`. */
function bibleCountKinds() {
  const block = between("The Deployer distinguishes:", "Do not count one SharePoint site")
  return [...block.matchAll(/^\d+\.\s+\*\*(.+?)\*\*\s+—\s+(.+?)\.?$/gm)].map((m) => ({
    name: m[1],
    definition: m[2],
  }))
}

/** §4.2's "must reject or warn on" bullets. */
function bibleDetectionBullets() {
  const block = between("The compiler must reject or warn on:", "\n## 5.")
  return [...block.matchAll(/^- (.+?)[;.]$/gm)].map((m) => m[1])
}

test("§1.1 still parses — the anchors this guard reads are present", () => {
  assert.equal(bibleModes().length, 14)
  assert.equal(bibleDimensions().length, 16)
  assert.equal(bibleCountKinds().length, 5)
  assert.equal(bibleDetectionBullets().length, 14)
})

test("the engine implements exactly §1.1's cardinality modes, in order", () => {
  // MUTATION TARGET: delete a mode from CARDINALITY_MODES, or add one the Bible
  // does not name. Both directions fail here.
  assert.deepEqual([...CARDINALITY_MODES], bibleModes())
})

test("the engine implements exactly §1.1's count dimensions, in order", () => {
  assert.deepEqual(
    COUNT_DIMENSIONS.map((d) => d.phrase),
    bibleDimensions(),
  )
})

test("dimension ids are unique, snake_case, and derived from the phrase's first alternative", () => {
  const ids = COUNT_DIMENSIONS.map((d) => d.id)
  assert.equal(new Set(ids).size, ids.length, "two dimensions share an id")
  for (const { id, phrase } of COUNT_DIMENSIONS) {
    assert.match(id, /^[a-z][a-z_]*$/, `${id} is not snake_case`)
    const first = phrase.split("/")[0]
    assert.ok(
      first.replace(/[ -]/g, "_").startsWith(id.split("_")[0]),
      `dimension id "${id}" does not come from the Bible's phrase "${phrase}"`,
    )
  }
})

test("the five count kinds are §1's five, with the Bible's own definitions", () => {
  assert.deepEqual(
    COUNT_KINDS.map((k) => ({ name: k.name, definition: k.definition })),
    bibleCountKinds(),
  )
})

test("decided plus deferred detections are exactly §4.2's fourteen bullets", () => {
  // MUTATION TARGET: drop an entry from DETECTIONS_DEFERRED. Implementing nine
  // of fourteen is honest; listing nine of fourteen is not.
  const claimed = [...DETECTIONS.map((d) => d.bullet), ...DETECTIONS_DEFERRED.map((d) => d.bullet)]
  assert.deepEqual([...claimed].sort(), [...bibleDetectionBullets()].sort())
  assert.equal(new Set(claimed).size, claimed.length, "a §4.2 bullet is claimed twice")
})

test("every deferred detection names what it needs and who owns it", () => {
  for (const d of DETECTIONS_DEFERRED) {
    assert.ok(d.needs && d.needs.length > 10, `"${d.bullet}" defers without saying what is missing`)
    assert.match(d.requirement, /^CAT-\d{3}-\d{3}$/)
  }
})

test("every declared mode has an evaluator — none falls through to the default", () => {
  // A mode in the list with no `case` would return "declared in §1.1 but has no
  // evaluator here", which is the exact shape of a vocabulary that compiles and
  // decides nothing.
  const instance = {
    id: "i1",
    capabilities: ["c"],
    providerProduct: "p.one",
    providerIdentity: "id-1",
    grant: "organization",
    role: "primary",
    regions: ["us"],
    legalEntities: ["e1"],
    environments: ["production"],
    dimensionValues: { tenant: ["t1"] },
    selectedResources: [],
  }
  const backup = { ...instance, id: "i2", providerIdentity: "id-2", role: "backup" }

  for (const mode of CARDINALITY_MODES) {
    const requirement = {
      id: `req-${mode}`,
      capability: "c",
      cardinality: {
        mode,
        n: 1,
        minimum: 1,
        maximum: 4,
        countBy: "tenant",
        dimensionValues: ["t1"],
      },
      providerPolicy: { eligibleProviderProducts: ["p.one"], mixedProvidersAllowed: true },
      population: { users: 1, connectedUsers: 1 },
    }
    const verdict = cardinalityVerdict(requirement, [instance, backup])
    assert.equal(
      verdict.determinable,
      true,
      `${mode} could not be decided from a fully declared requirement: ${verdict.why}`,
    )
    assert.ok(
      !String(verdict.why ?? "").includes("no evaluator"),
      `${mode} is declared but has no evaluator`,
    )
  }
})

test("an undeclared mode is undeterminable rather than unsatisfied", () => {
  const verdict = cardinalityVerdict(
    { id: "r", capability: "c", cardinality: { mode: "AT_LEAST_SOME" } },
    [],
  )
  assert.equal(verdict.determinable, false)
  assert.equal(verdict.satisfied, null)
  assert.match(verdict.why, /not one of the fourteen cardinality modes/)
})
