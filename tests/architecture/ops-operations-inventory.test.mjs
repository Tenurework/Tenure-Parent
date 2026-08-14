import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { test } from "node:test"

import {
  BIBLE,
  COLLISIONS,
  OPERATOR_ROOTS,
  OUTPUT,
  PRODUCT_ROOTS,
  ROOT,
  SCHEMA,
  TERMS,
  VERDICTS,
  build,
  byCodepoint,
  canonicalEntities,
  collisionProblems,
  read,
  schemaDeclarations,
  sourceFiles,
  verdictProblems,
  vocabularyHits,
} from "../../tools/ops-operations-inventory.mjs"

/**
 * OPS-000-001's inventory is re-derived here and compared to what is committed.
 *
 * An inventory is a claim about the repository, and the way this programme has
 * failed before is a plausible document assembled from a Bible's own wording,
 * describing code nobody has. Every row of
 * `docs/architecture/ops-operations-code-inventory.md` comes from a file that
 * exists — the Bible's §2 entity list, `apps/web/prisma/schema.prisma`, and a
 * scan of the tenant product — and this rebuilds all of it and demands the
 * committed document match byte for byte.
 *
 * The comparison normalises CRLF on the committed side only. `.gitattributes`
 * pins `* text=auto eol=lf`, so the working tree should be LF everywhere, but a
 * guard that reds on a checkout setting rather than on content is the
 * checkout-dependent artefact this repository has already shipped four times.
 *
 * What each assertion below is for, so none of them is decoration:
 *
 *   - the floors stop a scan that finds nothing from reporting a clean sweep;
 *   - the two detector self-tests stop `build()`'s refusals from becoming
 *     functions that return `[]` for everything;
 *   - the byte comparison catches a removed or corrupted row;
 *   - the absence check catches the one thing the byte comparison cannot,
 *     which is the document and the generator being wrong together about
 *     whether a canonical entity exists.
 */

const committed = () => fs.readFileSync(path.join(ROOT, OUTPUT), "utf8").replace(/\r\n/g, "\n")

test("the sources this inventory is derived from are all present", () => {
  for (const rel of [BIBLE, SCHEMA, OUTPUT]) {
    assert.ok(fs.existsSync(path.join(ROOT, rel)), `${rel} is missing; the inventory has no source.`)
  }
})

test("the derivation finds enough to be worth checking", () => {
  // Floors. Every assertion in this file passes trivially against empty inputs,
  // and the failure this guards against is a scanner that silently stops
  // matching — which reports a repository with no Operations claims in it,
  // which is exactly the conclusion the document draws.
  const entities = canonicalEntities()
  const declarations = schemaDeclarations()
  const hits = vocabularyHits(sourceFiles(PRODUCT_ROOTS))

  assert.ok(entities.length >= 70, `Parsed ${entities.length} canonical entities from ${BIBLE} §2, expected 70+.`)
  assert.ok(declarations.size >= 60, `Parsed ${declarations.size} declarations from ${SCHEMA}, expected 60+.`)
  assert.ok(TERMS.length >= 20, `Only ${TERMS.length} Operations terms are scanned for.`)
  assert.ok(hits.length >= 20, `The vocabulary scan found ${hits.length} matches in the product, expected 20+.`)
  assert.ok(VERDICTS.length >= 10, `Only ${VERDICTS.length} files carry a verdict.`)
  assert.ok(COLLISIONS.length >= 1, "No name collision is recorded, so section 2 proves nothing.")
})

test("the operator plane is excluded on a measured basis, not an assumed one", () => {
  // Section 3 excludes `apps/system-studio/src` and deliberately does not commit
  // its match count: it is in the hundreds and it moves with every other
  // domain's work, so a number there would make this document stale on somebody
  // else's commit. A floor is the part that must not rot — an exclusion nobody
  // measures is indistinguishable from not having looked, and if the scanner
  // ever stops matching there it would also have stopped matching in section 3
  // while the document still read "no Operations claims".
  const operatorHits = vocabularyHits(sourceFiles(OPERATOR_ROOTS))
  assert.ok(
    operatorHits.length >= 50,
    `The operator-plane scan found ${operatorHits.length} matches, expected 50+. The document says its ` +
      `count "is in the hundreds"; either that is no longer true or the scanner has stopped working.`,
  )
  assert.ok(
    operatorHits.some((h) => h.file === "apps/system-studio/src/lib/aws/inventory.ts"),
    "The document names apps/system-studio/src/lib/aws/inventory.ts as the reason for the exclusion.",
  )
})

test("the collision detector flags a real drift and clears a matching note", () => {
  // Exercised directly against synthetic input. `build()` refuses on a non-empty
  // return, so a detector that always returned [] would leave the generator
  // looking identical and checking nothing.
  const declarations = new Map([["Asset", { kind: "model", line: 10 }]])
  const schema = "model Asset {\n  id String\n}\n"

  // A canonical name in the schema with nobody having read it.
  assert.match(
    collisionProblems(["Asset"], declarations, [], schema)[0],
    /`Asset` is a canonical OPS entity name that now exists/,
  )
  // A note for a name that is not in the schema at all.
  assert.match(
    collisionProblems(["Asset"], new Map(), [["Asset", "x", "id String", "y"]], schema)[0],
    /no longer collides/,
  )
  // A note whose quoted evidence is not in the schema.
  assert.match(
    collisionProblems(["Asset"], declarations, [["Asset", "x", "quantityOnHand Int", "y"]], schema)[0],
    /The evidence quoted for `Asset` is not in/,
  )
  // And silent when the note matches the schema.
  assert.deepEqual(collisionProblems(["Asset"], declarations, [["Asset", "x", "id String", "y"]], schema), [])
})

test("the verdict detector flags an unjudged file and a judgement with no code", () => {
  assert.match(verdictProblems(["a/b.ts"], [])[0], /`a\/b\.ts` uses Operations vocabulary and has no verdict/)
  assert.match(verdictProblems([], [["a/b.ts", "unrelated-word", "x"]])[0], /which the scan no longer matches/)
  assert.deepEqual(verdictProblems(["a/b.ts"], [["a/b.ts", "unrelated-word", "x"]]), [])
})

test("the committed inventory is what the tree says today", () => {
  // The whole point. Removing or corrupting one row of the document — a
  // canonical entity, a file:line, a collision note — makes this red, which is
  // the difference between an inventory and a paragraph.
  assert.equal(
    committed(),
    build(),
    `${OUTPUT} disagrees with the tree. Re-derive it: node tools/ops-operations-inventory.mjs`,
  )
})

test("every entity the inventory calls absent really is absent from the schema", () => {
  // The one failure the byte comparison cannot see: the document and the
  // generator being wrong together. This reads the schema directly rather than
  // through `schemaDeclarations`, so a parser that stopped recognising `model`
  // lines would be caught here rather than agreeing with itself.
  const doc = committed()
  const schema = read(SCHEMA)
  const claimedAbsent = [...doc.matchAll(/^\| `([A-Za-z][A-Za-z0-9]*)` \| absent \|$/gm)].map((m) => m[1])
  assert.ok(claimedAbsent.length >= 60, `Only ${claimedAbsent.length} absence rows parsed out of ${OUTPUT}.`)

  const wrong = claimedAbsent.filter(
    (name) => new RegExp(`^(model|enum)\\s+${name}\\s*\\{`, "m").test(schema),
  )
  assert.deepEqual(
    wrong,
    [],
    "The inventory says these canonical OPS entities are absent and the schema declares them. " +
      "An inventory that is wrong about what exists is worse than no inventory.",
  )
})

test("every collision the inventory records really is declared in the schema", () => {
  const schema = read(SCHEMA)
  const missing = COLLISIONS.filter(([name]) => !new RegExp(`^(model|enum)\\s+${name}\\s*\\{`, "m").test(schema))
  assert.deepEqual(missing.map(([n]) => n), [], "A recorded name collision names a model the schema does not declare.")
})

test("every repository path the inventory cites is a path that exists", () => {
  // A citation nobody can open is the failure mode this programme is measured
  // on. Backticked strings that look like repository paths are resolved.
  const doc = committed()
  const cited = new Set()
  for (const m of doc.matchAll(/`([\w][\w./-]*\.(?:ts|tsx|mjs|js|prisma|json|md|sql|yaml|yml))`/g)) {
    cited.add(m[1])
  }
  assert.ok(cited.size >= 8, `Only ${cited.size} file citations found in ${OUTPUT}; the shape has changed.`)
  const missing = [...cited].filter((p) => !fs.existsSync(path.join(ROOT, p))).sort(byCodepoint)
  assert.deepEqual(missing, [], `${OUTPUT} cites files that do not exist.`)
})

test("the two models section 4 names as the event machinery are really there", () => {
  // Section 4 tells whoever picks up OPS-000-003 that the outbox and inbox
  // already exist. That is a claim about the schema and it is checked like one.
  const schema = read(SCHEMA)
  for (const name of ["OutboxEvent", "InboxEvent"]) {
    assert.match(schema, new RegExp(`^model\\s+${name}\\s*\\{`, "m"), `${SCHEMA} no longer declares ${name}.`)
    assert.ok(committed().includes(`\`model ${name}\``), `${OUTPUT} stopped naming ${name}.`)
  }
})

test("the derivation is stable when run twice", () => {
  // Cheap insurance against an unsorted readdir or a Set iteration order
  // leaking into the output. It would show up as an intermittently stale
  // document in CI and as nothing at all locally.
  assert.equal(build(), build())
})
