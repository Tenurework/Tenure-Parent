import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { test } from "node:test"

import {
  CONTROL_PLANE_ROUTES,
  ROOT,
  SOURCE,
  OUT_DIR,
  fileNameFor,
  generate,
} from "../../tools/contract-schemas.mjs"

/**
 * STUDIO-130-001 — the published schema says what the parser enforces.
 *
 * A JSON Schema written by hand beside a parser is the artefact that drifts.
 * It drifts silently, and it drifts in the worst direction: the document a
 * producer in another language validates against goes on admitting a field the
 * runtime gate started refusing last month, so the producer's own CI is green
 * and the platform rejects every message it sends.
 *
 * Two things are checked here, and neither is satisfiable by writing prose.
 *
 * 1. The committed `docs/contracts/*.schema.json` is exactly what
 *    `tools/contract-schemas.mjs` extracts from the contracts package today. A
 *    rule tightened in the parser and not regenerated fails here.
 *
 * 2. Over a committed table of accept/reject fixtures, the published schema
 *    gives the SAME verdict as the parser — with the cross-field rules named
 *    individually rather than waved at. `docs/contracts/conformance-fixtures.json`
 *    marks each rejection `schema` or `parser`; this file asserts the schema
 *    refuses every `schema` row (and names the same field) and ACCEPTS every
 *    `parser` row, which is what makes "the schema is weaker here, in exactly
 *    these five places" a checked statement rather than a caveat.
 *
 * `packages/contracts/src/contracts.test.ts` runs the identical table through
 * the real parsers and asserts every row is refused. One table, two readers: a
 * schema that admits what the parser refuses cannot survive both.
 *
 * ── Why the validator below is a second implementation ──────────────────────
 *
 * The parsers are TypeScript and this suite runs on Node 20, where there is no
 * type stripping. Rather than pretend the check is unnecessary, the eleven
 * keywords are implemented again here, deliberately, as a reference reading of
 * the published document — which is what an external producer would write. The
 * fixture table is what holds the two implementations together: if they came to
 * disagree about a keyword on any covered case, one of the two suites reds.
 */

const FIXTURES = "docs/contracts/conformance-fixtures.json"

function read(relative) {
  return fs.readFileSync(path.join(ROOT, relative), "utf8")
}

/* --------------------------------------------------- a reference validator -- */

function typeOf(value) {
  if (value === null) return "null"
  if (Array.isArray(value)) return "array"
  if (Number.isInteger(value)) return "integer"
  return typeof value
}

function matchesType(value, type) {
  if (type === "number") return typeof value === "number" && Number.isFinite(value)
  if (type === "integer") return typeof value === "number" && Number.isInteger(value)
  return typeOf(value) === type
}

/** The first violation, as `{ field }`, or null when the value is admitted. */
export function checkAgainstSchema(schema, value, path = "(root)") {
  if (schema.type !== undefined) {
    const types = typeof schema.type === "string" ? [schema.type] : schema.type
    if (!types.some((t) => matchesType(value, t))) return { field: path }
  }
  if (schema.enum !== undefined && !schema.enum.includes(value)) return { field: path }

  if (typeof value === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength) return { field: path }
    if (schema.maxLength !== undefined && value.length > schema.maxLength) return { field: path }
    if (schema.pattern !== undefined && !new RegExp(schema.pattern).test(value)) return { field: path }
    if (schema.format === "date-time" && Number.isNaN(Date.parse(value))) return { field: path }
  }
  if (typeof value === "number" && schema.minimum !== undefined && value < schema.minimum) {
    return { field: path }
  }

  if (Array.isArray(value) && schema.items) {
    for (let i = 0; i < value.length; i++) {
      const found = checkAgainstSchema(schema.items, value[i], `${path}[${i}]`)
      if (found) return found
    }
  }

  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    for (const key of schema.required ?? []) {
      if (!(key in value)) return { field: path === "(root)" ? key : `${path}.${key}` }
    }
    for (const [key, raw] of Object.entries(value)) {
      const at = path === "(root)" ? key : `${path}.${key}`
      if (schema.propertyNames?.pattern && !new RegExp(schema.propertyNames.pattern).test(key)) {
        return { field: path }
      }
      if (schema.propertyNames?.maxLength && key.length > schema.propertyNames.maxLength) {
        return { field: path }
      }
      const child = schema.properties?.[key]
      if (child) {
        const found = checkAgainstSchema(child, raw, at)
        if (found) return found
        continue
      }
      // Reported against the object, matching the parser: the offending key
      // came from the input, and a violation must not carry input.
      if (schema.additionalProperties === false) return { field: path }
      if (typeof schema.additionalProperties === "object") {
        const found = checkAgainstSchema(schema.additionalProperties, raw, at)
        if (found) return found
      }
    }
  }

  return null
}

/* ------------------------------------------------------------- the checks -- */

test("the reference validator refuses and admits for the right reasons", () => {
  // Exercised directly. A validator that returned null for everything would
  // make the fixture check below vacuous while looking identical in CI.
  const schema = {
    type: "object",
    additionalProperties: false,
    required: ["a"],
    properties: { a: { type: "string", pattern: "^x+$" }, n: { type: "integer" } },
  }
  assert.equal(checkAgainstSchema(schema, { a: "xxx" }), null)
  assert.deepEqual(checkAgainstSchema(schema, {}), { field: "a" })
  assert.deepEqual(checkAgainstSchema(schema, { a: "y" }), { field: "a" })
  assert.deepEqual(checkAgainstSchema(schema, { a: "x", n: 1.5 }), { field: "n" })
  assert.deepEqual(checkAgainstSchema(schema, { a: "x", other: 1 }), { field: "(root)" })
})

test("the committed schemas are what the contracts package says today", () => {
  const generated = generate(read(SOURCE))
  const names = Object.keys(generated).sort()

  assert.ok(names.length >= 4, `Only ${names.length} control-plane schemas were extracted.`)

  const stale = []
  for (const [name, text] of Object.entries(generated)) {
    const file = path.join(ROOT, OUT_DIR, name)
    if (!fs.existsSync(file)) {
      stale.push(`${OUT_DIR}/${name} is not committed`)
      continue
    }
    if (fs.readFileSync(file, "utf8") !== text) stale.push(`${OUT_DIR}/${name} differs from the parser`)
  }

  assert.deepEqual(
    stale,
    [],
    `The published contract documents no longer match the parsers that enforce them.\n` +
      `Run \`node tools/contract-schemas.mjs\` and commit the result.\n  ${stale.join("\n  ")}`,
  )
})

test("every published schema carries its contract version in its identity", () => {
  // An unversioned schema cannot be refused by a consumer: there is nothing to
  // compare. The whole requirement is "versioned control-plane contracts".
  for (const name of fs.readdirSync(path.join(ROOT, OUT_DIR))) {
    if (!name.endsWith(".schema.json")) continue
    const doc = JSON.parse(read(`${OUT_DIR}/${name}`))
    assert.match(doc["x-contract-version"], /^\d+\.\d+$/, `${name} states no MAJOR.MINOR version`)
    assert.ok(doc.$id.includes(doc["x-contract-version"]), `${name}'s $id does not carry its version`)
    assert.ok(doc.required?.includes("schemaVersion"), `${name} does not require schemaVersion on the value`)
  }
})

test("the published schema gives the same verdict as the parser, fixture by fixture", () => {
  const fixtures = JSON.parse(read(FIXTURES))
  const contracts = Object.keys(fixtures).filter((k) => k !== "//")
  assert.ok(contracts.length >= 4, `Only ${contracts.length} contracts have fixtures.`)

  const wrong = []
  let accepted = 0
  let refusedBySchema = 0
  let refusedByParserOnly = 0

  for (const contract of contracts) {
    const doc = JSON.parse(read(`${OUT_DIR}/${fileNameFor(contract)}.schema.json`))

    for (const row of fixtures[contract].accept) {
      const found = checkAgainstSchema(doc, row.value)
      if (found) wrong.push(`${contract}: schema refused ${found.field} on an accepted fixture — ${row.why}`)
      else accepted++
    }

    for (const row of fixtures[contract].reject) {
      const found = checkAgainstSchema(doc, row.value)
      if (row.by === "schema") {
        if (!found) wrong.push(`${contract}: schema admitted a rejected fixture — ${row.why}`)
        else if (found.field !== row.field) {
          wrong.push(`${contract}: schema blamed ${found.field}, the parser blames ${row.field} — ${row.why}`)
        } else refusedBySchema++
      } else {
        // Named individually on purpose. "The schema is a bit weaker" is not a
        // statement anybody can check; "the schema admits exactly these five,
        // and the runtime gate is what refuses them" is.
        if (found) wrong.push(`${contract}: fixture is marked a cross-field rule but the schema caught it at ${found.field} — ${row.why}`)
        else refusedByParserOnly++
      }
    }
  }

  assert.deepEqual(wrong, [], `The published schema and the parser disagree:\n  ${wrong.join("\n  ")}`)
  assert.ok(accepted >= 8, `Only ${accepted} accept fixtures ran; the table is not exercising the schemas.`)
  assert.ok(refusedBySchema >= 10, `Only ${refusedBySchema} structural refusals ran.`)
  assert.ok(refusedByParserOnly >= 5, `Only ${refusedByParserOnly} cross-field refusals are named.`)
})

test("no published contract admits a change domain nothing computes", () => {
  // STUDIO-060-003's central decision, asserted where it can be seen from
  // outside the repository. Five of the ten domains the requirement names are
  // absent from the enum rather than emitted as empty sections, because an
  // empty `integrations` array reads as "nothing changed in integrations" —
  // the opposite of "we do not compute this".
  const doc = JSON.parse(read(`${OUT_DIR}/change-diff.schema.json`))
  const domains = doc.properties.entries.items.properties.domain.enum

  assert.deepEqual([...domains].sort(), ["app-config", "aws-resource", "cost", "relay", "rollback"])
  for (const absent of ["data-schema", "iam", "domain", "integration", "operations"]) {
    assert.ok(!domains.includes(absent), `${absent} is in the enum but nothing emits it`)
  }
})

/* ------------------------------------------------------------- OpenAPI -- */

const OPENAPI = `${OUT_DIR}/control-plane.openapi.json`

test("the OpenAPI document describes only routes this repository serves", () => {
  // STUDIO-130-001. An OpenAPI document is the artefact most likely to be
  // fiction: nothing executes it, so an endpoint that was renamed, or one that
  // was described before it was written, goes on being published and a client
  // generated from it compiles against a 404.
  //
  // So every path here is checked twice — against the surface table the router
  // admits, and against the route file on disk that serves it.
  const doc = JSON.parse(read(OPENAPI))
  const result = read("apps/system-studio/src/lib/aws/result.ts")

  // The `SURFACES` keys, read out of the source the router imports. A surface
  // added there and not described here (or the reverse) fails.
  const block = /export const SURFACES = \{([\s\S]*?)\n\} as const/.exec(result)
  assert.ok(block, "apps/system-studio/src/lib/aws/result.ts no longer exports SURFACES in the expected shape")
  const served = [...block[1].matchAll(/^ {2}(\w+): \{$/gm)].map((m) => m[1]).sort()
  assert.ok(served.length >= 3, `Only ${served.length} surfaces were read out of result.ts.`)

  const described = CONTROL_PLANE_ROUTES.map((r) => r.surface).sort()
  assert.deepEqual(described, served, "the OpenAPI route table and the router's SURFACES disagree")

  for (const route of CONTROL_PLANE_ROUTES) {
    assert.ok(doc.paths[route.path], `${route.path} is in the route table and not in the document`)
    // The dynamic segment that actually serves it. There is one file; if it
    // moves, every described path is wrong at once.
    const file = "apps/system-studio/src/app/api/aws/[surface]/route.ts"
    assert.ok(fs.existsSync(path.join(ROOT, file)), `${file} does not exist, so nothing serves ${route.path}`)
    const source = read(file)
    for (const method of route.methods) {
      assert.match(
        source,
        new RegExp(`export async function ${method.toUpperCase()}\\(`),
        `${route.path} documents ${method.toUpperCase()} and the route exports no such handler`,
      )
    }
  }

  assert.deepEqual(
    Object.keys(doc.paths).sort(),
    CONTROL_PLANE_ROUTES.map((r) => r.path).sort(),
    "the document describes a path the route table does not name",
  )
})

test("the OpenAPI document's components are the schemas the parsers run", () => {
  // Not a restatement. `components.schemas` is generated from the same
  // `CONTROL_PLANE_SCHEMAS` object the runtime parsers execute, so an endpoint
  // cannot promise a shape the gate would refuse.
  const doc = JSON.parse(read(OPENAPI))
  const generated = generate(read(SOURCE))

  assert.equal(fs.readFileSync(path.join(ROOT, OPENAPI), "utf8"), generated["control-plane.openapi.json"],
    "docs/contracts/control-plane.openapi.json is stale. Run `node tools/contract-schemas.mjs` and commit the result.")

  for (const name of Object.keys(generated).filter((f) => f.endsWith(".schema.json"))) {
    const published = JSON.parse(read(`${OUT_DIR}/${name}`))
    const contract = published["x-contract"]
    const component = doc.components.schemas[contract]
    assert.ok(component, `${contract} has a published schema and no OpenAPI component`)
    assert.equal(component["x-contract-version"], published["x-contract-version"])
    assert.deepEqual(component.required ?? [], published.required ?? [],
      `${contract}'s OpenAPI component and its published schema require different fields`)
  }

  // Every problem type the document promises must exist in the module that
  // mints them, so a status code cannot document a `type` no code can return.
  const problems = read("apps/system-studio/src/lib/api/problem.ts")
  for (const operations of Object.values(doc.paths)) {
    for (const operation of Object.values(operations)) {
      for (const [status, response] of Object.entries(operation.responses)) {
        if (Number(status) < 400) continue
        assert.match(problems, new RegExp(`\\b${response.description}:`),
          `${status} names problem type "${response.description}", which PROBLEM does not define`)
      }
    }
  }
})

test("the API envelope carries the contract version at the boundary that serves it", () => {
  // The requirement's own wiring clause: the envelope carries the contract's
  // schemaVersion. Asserted on the production builder rather than on the
  // contract, because a version on the shape and none on the response is the
  // failure this is here to catch.
  const envelope = read("apps/system-studio/src/lib/api/envelope.ts")
  assert.match(envelope, /parseApiEnvelope</, "envelope() no longer parses through the published contract")
  assert.match(
    envelope,
    /schemaVersion: CONTROL_PLANE_SCHEMA_VERSIONS\.ApiEnvelope/,
    "envelope() no longer stamps the contract version onto the response",
  )
  // Stamped inside, never accepted from a caller: a caller that could choose
  // the version could claim compatibility it does not have. Read off the
  // PARAMETER list alone, not the whole file — a lazy match over the body would
  // find the stamp above and pass for the wrong reason.
  const signature = /export function envelope<T>\(input: \{([\s\S]*?)\}\): Envelope<T> \{/.exec(envelope)
  assert.ok(signature, "envelope() no longer has the signature this check reads")
  assert.doesNotMatch(
    signature[1],
    /schemaVersion/,
    "envelope() takes schemaVersion from its caller, which lets a caller lie about it",
  )
})

test("every domain the schema admits has a producer in the Studio", () => {
  // The other half of the same decision, and the one that stops the enum
  // growing by aspiration. A domain in the published contract that nothing
  // emits is exactly the "documentation with a parser attached" the contracts
  // package's own header refuses — so each admitted domain is matched to the
  // source line that constructs an entry carrying it.
  const doc = JSON.parse(read(`${OUT_DIR}/change-diff.schema.json`))
  const domains = doc.properties.entries.items.properties.domain.enum

  const producers = {
    "app-config": "apps/system-studio/src/lib/revisions.ts",
    relay: "apps/system-studio/src/lib/revisions.ts",
    rollback: "apps/system-studio/src/lib/revisions.ts",
    "aws-resource": "apps/system-studio/src/lib/aws/drift.ts",
    cost: "apps/system-studio/src/lib/aws/drift.ts",
  }

  const orphans = []
  for (const domain of domains) {
    const file = producers[domain]
    if (!file) {
      orphans.push(`${domain} is admitted by the schema and no producer is named for it`)
      continue
    }
    // The literal a `ChangeDiffEntry` is built with. `changeDomainForKey`
    // returns `"relay"` or `"app-config"`; the other three are written inline.
    const source = read(file)
    if (!new RegExp(`"${domain}"`).test(source)) {
      orphans.push(`${domain} is admitted by the schema but ${file} never emits it`)
    }
  }

  assert.deepEqual(orphans, [], orphans.join("\n  "))
})
