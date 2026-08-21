import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { test } from "node:test"

import { SNAPSHOT as BASELINE_SNAPSHOT, SOURCE_REF, readBlobs } from "../../tools/simon-absorption-inventory.mjs"
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

/**
 * Neither pinned object is present on every machine, so a re-derivation from
 * git is a check that can RUN here and cannot run in CI.
 *
 * The source pin lives only in a clone that has `live` configured and fetched;
 * `actions/checkout@v4` fetches at depth 1, so even the target pin — an
 * ancestor of HEAD — is absent there. `readBlobs` answers a missing object by
 * omission, so `schemaAt` returns `undefined` rather than throwing, and a bare
 * `assert.ok(text, ...)` turns "we could not look" into "the snapshot is
 * wrong". Those are different answers.
 *
 * `tests/simon-absorption-inventory.test.mjs` already settled the shape: try
 * the re-derivation, and where the object is not there say so in a diagnostic
 * and fall through to the checks that need no git. Every case that uses this
 * carries such checks BEFORE the call, so skipping the git half never leaves a
 * case asserting nothing.
 */
const schemaOrSkip = (t, which, commit) => {
  const text = schemaAt(commit)
  if (!text) {
    t.diagnostic(
      `${which}: ${SCHEMA_PATH} is not readable at ${commit} in this clone (CI checks out at ` +
        `depth 1, and ${SOURCE_REF} is only present where \`git fetch live\` has run). ` +
        `Re-derivation from git skipped; the snapshot-internal checks above still ran.`,
    )
    return null
  }
  return text
}

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
  test(`${sideName} — every entity is a model declared in that tree's schema, and none is missing`, (t) => {
    const side = snapshot[sideName]
    // Runs everywhere: the entity list and the field dictionary are two views of
    // the same parse, and a row in one and not the other is a corrupted snapshot
    // whether or not this machine can reach the pinned commit.
    const names = side.entities.map((e) => e.entity)
    assert.deepEqual(names.slice().sort(), [...new Set(names)].sort(), "an entity is listed twice")
    assert.deepEqual(names.slice().sort(), Object.keys(side.dictionary).sort())
    for (const entity of side.entities)
      assert.equal(entity.fields, side.dictionary[entity.entity].length, `${entity.entity} field count vs dictionary`)
    const enumNames = side.enums.map((e) => e.name)
    assert.deepEqual(enumNames.slice().sort(), [...new Set(enumNames)].sort(), "an enum is listed twice")
    for (const e of side.enums) assert.ok(e.values.length > 0, `enum ${e.name} declares no members`)

    const text = schemaOrSkip(t, sideName, side.pinned_commit)
    if (!text) return
    // An independent read of the declarations: `model X {` at the start of a line.
    const declared = [...text.matchAll(/^model\s+([A-Za-z0-9_]+)\s*\{/gm)].map((m) => m[1]).sort()
    assert.ok(declared.length >= 30, `read only ${declared.length} models — this parser is broken, not the schema`)
    assert.deepEqual(side.entities.map((e) => e.entity).sort(), declared)
    const enums = [...text.matchAll(/^enum\s+([A-Za-z0-9_]+)\s*\{/gm)].map((m) => m[1]).sort()
    assert.deepEqual(side.enums.map((e) => e.name).sort(), enums)
  })

  test(`${sideName} — every key, constraint and index count re-derives from the schema`, (t) => {
    const side = snapshot[sideName]
    // Runs everywhere. `accessorOf` is a pure function of the entity name, and
    // every key, index and constraint names fields the dictionary carries — a
    // claim about the snapshot's own consistency, not about git.
    for (const entity of side.entities) {
      assert.equal(entity.accessor, accessorOf(entity.entity))
      const fields = new Set(side.dictionary[entity.entity].map((f) => f.field))
      for (const f of entity.primary_key)
        assert.ok(fields.has(f), `${entity.entity} primary key names "${f}", which is not one of its fields`)
      // An index or unique constraint renders as its field names joined by "+";
      // a foreign key as "<field> → Target(id)…". Both name fields of THIS
      // entity, so both re-check against its own dictionary.
      for (const rendered of entity.indexes.concat(entity.unique_constraints))
        for (const f of rendered.split("+"))
          assert.ok(fields.has(f), `${entity.entity} constraint names "${f}", which is not one of its fields`)
      for (const rendered of entity.foreign_keys) {
        const f = rendered.split(" ")[0]
        assert.ok(fields.has(f), `${entity.entity} foreign key names "${f}", which is not one of its fields`)
      }
    }
    // Non-vacuity, also everywhere: a schema this size has keys, constraints and
    // indexes, and an empty parse would satisfy every "for every" above.
    assert.ok(side.entities.some((e) => e.primary_key.length), `no entity on the ${sideName} side has a primary key`)
    assert.ok(side.entities.some((e) => e.indexes.length), `no entity on the ${sideName} side has an index`)
    assert.ok(side.entities.some((e) => e.foreign_keys.length), `no entity on the ${sideName} side has a foreign key`)

    const text = schemaOrSkip(t, sideName, side.pinned_commit)
    if (!text) return
    const parsed = parseSchema(text)
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
    }
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

test("an enumeration carried by both trees with different members is reported", (t) => {
  // The specific finding this exists to make visible, and the one a refuter
  // used to overturn SIMON-000-005: the same name, different semantics, in a
  // financial ledger.
  const ledger = snapshot.comparison.enums_differing.find((e) => e.name === "LedgerKind")
  assert.ok(ledger, "LedgerKind no longer differs between the two schemas — check this before deleting the case")
  assert.deepEqual(ledger.source, ["SPEND", "REIMBURSEMENT", "ADJUSTMENT"])
  assert.ok(ledger.target.includes("REVERSAL"), "the target LedgerKind no longer carries REVERSAL")
  // Runs everywhere: every reported divergence is between two enumerations the
  // snapshot's own per-side lists carry, and really differs.
  for (const row of snapshot.comparison.enums_differing) {
    const s = snapshot.source.enums.find((e) => e.name === row.name)
    const tgt = snapshot.target.enums.find((e) => e.name === row.name)
    assert.ok(s, `${row.name} is reported as differing and is not in the source enum list`)
    assert.ok(tgt, `${row.name} is reported as differing and is not in the target enum list`)
    assert.deepEqual(row.source, s.values)
    assert.deepEqual(row.target, tgt.values)
    assert.notDeepEqual(row.source, row.target)
  }
  // And nothing that differs is missing from the list.
  const targetByName = new Map(snapshot.target.enums.map((e) => [e.name, e.values]))
  const differing = snapshot.source.enums
    .filter((e) => targetByName.has(e.name))
    .filter((e) => JSON.stringify(e.values) !== JSON.stringify(targetByName.get(e.name)))
    .map((e) => e.name)
    .sort()
  assert.deepEqual(snapshot.comparison.enums_differing.map((r) => r.name).slice().sort(), differing)

  // Every reported divergence really is one, re-read from both schemas.
  const sourceText = schemaOrSkip(t, "source", snapshot.source.pinned_commit)
  const targetText = schemaOrSkip(t, "target", snapshot.target.pinned_commit)
  if (!sourceText || !targetText) return
  const sourceEnums = parseSchema(sourceText).enums
  const targetEnums = parseSchema(targetText).enums
  for (const row of snapshot.comparison.enums_differing) {
    assert.deepEqual(sourceEnums.find((e) => e.name === row.name).values, row.source)
    assert.deepEqual(targetEnums.find((e) => e.name === row.name).values, row.target)
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
