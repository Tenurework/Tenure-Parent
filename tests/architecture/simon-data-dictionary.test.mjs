import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { test } from "node:test"

import { SNAPSHOT as BASELINE_SNAPSHOT, readBlobs } from "../../tools/simon-absorption-inventory.mjs"
import { DOMAINS } from "../../tools/ownership-map.mjs"
import {
  DOC,
  RETENTION_FIELD_PATTERNS,
  ROOT,
  SCHEMA_PATH,
  SNAPSHOT,
  accessorOf,
  commitOf,
  parseSchema,
  render,
} from "../../tools/simon-data-dictionary.mjs"

/**
 * SIMON-000-014 — the data dictionary and entity matrix for both systems.
 *
 * The inputs are two PINNED commits, so unlike the boundary guard this one can
 * and does assert snapshot equality: the trees it describes cannot change under
 * it, and a document that no longer renders from its own snapshot is a document
 * somebody hand-edited.
 *
 * Every claim below is re-derived from the schema text at the pinned commit
 * with this file's own parse, never by calling the generator's helpers on the
 * generator's own output. A guard that re-runs the code it is guarding proves
 * the code is deterministic and nothing else.
 */

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8").replace(/\r\n/g, "\n")
const snapshot = JSON.parse(read(SNAPSHOT))
const baseline = JSON.parse(read(BASELINE_SNAPSHOT))

/** The schema text at each pinned commit, read again here rather than trusted. */
const schemaAt = (commit) => readBlobs(commit, [SCHEMA_PATH]).get(SCHEMA_PATH)

test("the document is exactly what the snapshot renders", () => {
  assert.equal(render(snapshot), read(DOC))
})

test("both sides are the commits the baseline pinned, not commits re-resolved here", () => {
  // The property `tools/simon-convergence-inventory.mjs` states and this
  // inherits: an analysis must not be able to re-pin the baseline underneath
  // itself, or two documents about "the two trees" describe three.
  assert.equal(snapshot.source.pinned_commit, commitOf(baseline.source))
  assert.equal(snapshot.target.pinned_commit, commitOf(baseline.target))
  assert.match(snapshot.source.pinned_commit, /^[0-9a-f]{40}$/)
  assert.match(snapshot.target.pinned_commit, /^[0-9a-f]{40}$/)
  assert.notEqual(snapshot.source.pinned_commit, snapshot.target.pinned_commit)
})

for (const sideName of ["source", "target"]) {
  test(`${sideName} — every entity is a model declared in that tree's schema, and none is missing`, () => {
    const side = snapshot[sideName]
    const text = schemaAt(side.pinned_commit)
    assert.ok(text, `${SCHEMA_PATH} is not readable at ${side.pinned_commit}`)
    // An independent read of the declarations: `model X {` at the start of a line.
    const declared = [...text.matchAll(/^model\s+([A-Za-z0-9_]+)\s*\{/gm)].map((m) => m[1]).sort()
    assert.ok(declared.length >= 30, `read only ${declared.length} models — this parser is broken, not the schema`)
    assert.deepEqual(side.entities.map((e) => e.entity).sort(), declared)
    const enums = [...text.matchAll(/^enum\s+([A-Za-z0-9_]+)\s*\{/gm)].map((m) => m[1]).sort()
    assert.deepEqual(side.enums.map((e) => e.name).sort(), enums)
  })

  test(`${sideName} — every key, constraint and index count re-derives from the schema`, () => {
    const side = snapshot[sideName]
    const parsed = parseSchema(schemaAt(side.pinned_commit))
    for (const entity of side.entities) {
      const model = parsed.models.find((m) => m.name === entity.entity)
      assert.ok(model, `${entity.entity} is in the snapshot and not in the schema`)
      assert.equal(entity.fields, model.fields.length, `${entity.entity} field count`)
      // Counted from the raw block attributes rather than from the generator's
      // structured output, so a bug that dropped one shows up as a number.
      const blockIndexes = model.blockAttributes.filter((a) => a.startsWith("@@index")).length
      assert.equal(entity.indexes.length, blockIndexes, `${entity.entity} index count`)
      const uniques =
        model.blockAttributes.filter((a) => a.startsWith("@@unique")).length +
        model.fields.filter((f) => f.attributes.some((a) => a === "@unique" || a.startsWith("@unique("))).length
      assert.equal(entity.unique_constraints.length, uniques, `${entity.entity} unique constraint count`)
      const relationsWithKeys = model.fields.filter((f) =>
        f.attributes.some((a) => a.startsWith("@relation(") && a.includes("fields:")),
      ).length
      assert.equal(entity.foreign_keys.length, relationsWithKeys, `${entity.entity} foreign key count`)
      assert.equal(entity.accessor, accessorOf(entity.entity))
    }
    // Non-vacuity: a schema this size has keys, constraints and indexes, and a
    // parse that silently returned none would satisfy every equality above.
    assert.ok(side.entities.some((e) => e.primary_key.length), `no entity on the ${sideName} side has a primary key`)
    assert.ok(side.entities.some((e) => e.indexes.length), `no entity on the ${sideName} side has an index`)
    assert.ok(side.entities.some((e) => e.foreign_keys.length), `no entity on the ${sideName} side has a foreign key`)
  })

  test(`${sideName} — "NONE DECLARED" retention is a search that ran, not one that did not`, () => {
    const side = snapshot[sideName]
    for (const entity of side.entities) {
      const fields = side.dictionary[entity.entity].map((f) => f.field)
      const matching = fields.filter((f) => RETENTION_FIELD_PATTERNS.some((re) => re.test(f)))
      assert.deepEqual(
        entity.retention_fields.slice().sort(),
        matching.sort(),
        `${entity.entity} retention fields disagree with its own field list`,
      )
    }
  })

  test(`${sideName} — every owner domain is a real domain, and no entity nothing touches has one`, () => {
    const keys = new Set(DOMAINS.map((d) => d.key))
    const side = snapshot[sideName]
    for (const entity of side.entities) {
      for (const d of entity.owner_domains)
        assert.ok(keys.has(d), `${entity.entity} is owned by "${d}", which is not a platform domain`)
      if (entity.accessed_by_files === 0)
        assert.deepEqual(entity.owner_domains, [], `${entity.entity} has no accessor and yet has an owner`)
    }
    assert.ok(
      side.entities.some((e) => e.owner_domains.length),
      `no entity on the ${sideName} side resolved to an owning domain — the accessor scan is broken`,
    )
  })
}

test("the comparison re-adds from the two entity lists", () => {
  const source = new Set(snapshot.source.entities.map((e) => e.entity))
  const target = new Set(snapshot.target.entities.map((e) => e.entity))
  assert.deepEqual(snapshot.comparison.entities_only_in_source, [...source].filter((e) => !target.has(e)).sort())
  assert.deepEqual(snapshot.comparison.entities_only_in_target, [...target].filter((e) => !source.has(e)).sort())
  for (const row of snapshot.comparison.entities_with_differing_field_counts) {
    const s = snapshot.source.entities.find((e) => e.entity === row.entity)
    const t = snapshot.target.entities.find((e) => e.entity === row.entity)
    assert.equal(row.source_fields, s.fields)
    assert.equal(row.target_fields, t.fields)
    assert.notEqual(row.source_fields, row.target_fields)
  }
  // And nothing that differs is missing from the list.
  const differing = [...source]
    .filter((e) => target.has(e))
    .filter(
      (e) =>
        snapshot.source.entities.find((x) => x.entity === e).fields !==
        snapshot.target.entities.find((x) => x.entity === e).fields,
    )
    .sort()
  assert.deepEqual(snapshot.comparison.entities_with_differing_field_counts.map((r) => r.entity), differing)
})

test("an enumeration carried by both trees with different members is reported", () => {
  // The specific finding this exists to make visible, and the one a refuter
  // used to overturn SIMON-000-005: the same name, different semantics, in a
  // financial ledger.
  const ledger = snapshot.comparison.enums_differing.find((e) => e.name === "LedgerKind")
  assert.ok(ledger, "LedgerKind no longer differs between the two schemas — check this before deleting the case")
  assert.deepEqual(ledger.source, ["SPEND", "REIMBURSEMENT", "ADJUSTMENT"])
  assert.ok(ledger.target.includes("REVERSAL"), "the target LedgerKind no longer carries REVERSAL")
  // Every reported divergence really is one, re-read from both schemas.
  const sourceEnums = parseSchema(schemaAt(snapshot.source.pinned_commit)).enums
  const targetEnums = parseSchema(schemaAt(snapshot.target.pinned_commit)).enums
  for (const row of snapshot.comparison.enums_differing) {
    assert.deepEqual(sourceEnums.find((e) => e.name === row.name).values, row.source)
    assert.deepEqual(targetEnums.find((e) => e.name === row.name).values, row.target)
    assert.notDeepEqual(row.source, row.target)
  }
})

test("the artifacts carry no row of anybody's data", () => {
  // Ledger rule 8. This repository is public and the source tree carries a live
  // pilot's real records. Column names, types and counts are evidence; a value
  // out of a row is not, whatever it is being used to demonstrate.
  const text = read(SNAPSHOT) + read(DOC)
  const emails = text.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) ?? []
  assert.deepEqual(emails, [], "an email address reached a generated artifact")
})
