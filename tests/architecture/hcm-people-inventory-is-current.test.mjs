import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { execFileSync } from "node:child_process"
import { test } from "node:test"

import {
  BINDINGS,
  CLAIMS,
  DISTINCTIONS,
  MODULES,
  OUT,
  PEOPLE_MODELS,
  PEOPLE_MODELS_OFF_CORE,
  ROOT,
  SOURCE_DOC,
  anchorPresent,
  canonicalObjects,
  coreDistinctions,
  coreLinkedModels,
  exists,
  importersOf,
  organizationModelExports,
  prismaModels,
  read,
  verify,
} from "../../tools/hcm-people-inventory.mjs"

/**
 * HCM-000-001 — the people inventory is a claim about this repository, and this
 * is what makes it falsifiable.
 *
 * An inventory that nothing re-derives is prose. It is right on the day it is
 * written, indistinguishable from a wrong one afterwards, and the reader who
 * trusts it has no way to tell which they are holding. This repository has
 * already paid for that lesson twice — `entry-points.md` counted half the
 * platform, and the document graph could not see twelve whole domains — so the
 * rule here is the same one those settled on: the document is generated, and a
 * guard re-runs the generator against the tree.
 *
 * Three properties, and they fail differently:
 *
 *   1. **Still true.** Every declared row names a path and an anchor string
 *      inside it. Delete the function, rename the file, or reword the claim and
 *      `verify()` names the row.
 *   2. **Still complete.** Every model that owns a relation into the workforce
 *      core is classified, and every canonical object the source document names
 *      is bound. A new table hung off `Seat`, or an object added to §4, reds
 *      here rather than quietly leaving the inventory short.
 *   3. **Still current.** The committed markdown is byte-identical to what the
 *      generator produces now.
 *
 * The detectors are also exercised on synthetic input below, because all three
 * assertions above pass vacuously against a parser that finds nothing — and a
 * parser that finds nothing looks exactly like a clean repository in CI.
 *
 * Nothing here writes into the tree: `--check` only compares. See
 * `guards-do-not-write-into-the-tree.test.mjs` for why that matters.
 */

test("every row of the people inventory still describes the repository", () => {
  assert.deepEqual(
    verify(),
    [],
    "A row in the HCM people inventory no longer matches the tree. Fix the row in " +
      "tools/hcm-people-inventory.mjs — do not delete it to make this green; a row " +
      "removed is a fact the inventory stops reporting.",
  )
})

test("the committed inventory is current", () => {
  execFileSync("node", ["tools/hcm-people-inventory.mjs", "--check"], { cwd: ROOT, stdio: "pipe" })
})

test("the derivations are not vacuous", () => {
  // Every completeness assertion in this file is satisfied by a parser that
  // returns nothing, and would look identical in CI.
  const models = prismaModels()
  assert.ok(models.length >= 40, `Parsed ${models.length} Prisma models; the schema reader has stopped working.`)

  const linked = coreLinkedModels(models)
  assert.ok(linked.length >= 5, `Only ${linked.length} models link into the workforce core; the relation reader has stopped working.`)

  const objects = canonicalObjects()
  assert.ok(objects.length >= 40, `Parsed ${objects.length} canonical objects from ${SOURCE_DOC}; the "At minimum:" list has moved.`)

  const distinctions = coreDistinctions()
  assert.equal(distinctions.length, 10, "The source document's §2 list of distinctions is no longer ten items.")

  const exported = organizationModelExports()
  assert.ok(exported.length >= 50, `Parsed ${exported.length} exports from the organization model barrel; the export reader has stopped working.`)

  assert.ok(MODULES.length >= 20, `${MODULES.length} people modules inventoried; that is fewer than the repository has.`)
  assert.ok(CLAIMS.length >= 8, `${CLAIMS.length} claims audited; the audit has been hollowed out.`)
})

test("an anchor is a token, not a substring", () => {
  // This is the mutation the first version of the check survived. Renaming
  // `releaseToSuccessor` to `releaseToSuccessorRENAMED` removes the exported
  // symbol the inventory row is about and leaves the substring behind, so a
  // `includes()` anchor stayed GREEN across a real change to the tree. A guard
  // that cannot fail is worse than no guard: it is a reader's reason to stop
  // checking.
  assert.equal(anchorPresent("export function releaseToSuccessor(", "releaseToSuccessor"), true)
  assert.equal(anchorPresent("export function releaseToSuccessorRENAMED(", "releaseToSuccessor"), false)
  assert.equal(anchorPresent("const xreleaseToSuccessor = 1", "releaseToSuccessor"), false)
  // Prose anchors are bounded on the left only — a sentence is not extended by
  // suffixing an identifier to it, and its trailing full stop is not a word
  // character to bound against.
  assert.equal(anchorPresent("// Do not build payroll. Ever.", "Do not build payroll. Ever."), true)
  assert.equal(anchorPresent("// Do not build payroll soon. Ever.", "Do not build payroll. Ever."), false)
  // Regex metacharacters in an anchor are literal, not a pattern.
  assert.equal(anchorPresent('lifecycle: "certified-limited"', 'lifecycle: "certified-limited"'), true)
  assert.equal(anchorPresent("lifecycle: Xcertified-limitedX", 'lifecycle: "certified-limited"'), false)
})

test("the schema reader finds a model that is added, and the classifier demands a verdict on it", () => {
  // Synthetic, so the tree is untouched. This is the property the completeness
  // assertion rests on: a table hung off the workforce core must be classified
  // by somebody, not absorbed silently.
  const synthetic = [
    "model Seat {",
    "  id String @id",
    "}",
    "",
    "model WorkerCompensation {",
    "  id     String @id",
    "  seatId String",
    "  seat   Seat   @relation(fields: [seatId], references: [id])",
    "}",
    "",
    "model Unrelated {",
    "  id String @id",
    "}",
  ].join("\n")

  const models = prismaModels(synthetic)
  assert.deepEqual(models.map((m) => m.name), ["Seat", "WorkerCompensation", "Unrelated"])

  const linked = coreLinkedModels(models)
  assert.deepEqual(linked, [{ name: "WorkerCompensation", links: ["Seat"] }])

  const classified = new Set(PEOPLE_MODELS.map(([n]) => n))
  assert.ok(!classified.has("WorkerCompensation"), "the synthetic model must not already be classified")
})

test("the canonical-object reader reads the document and not a copy of it", () => {
  const synthetic = ["## 4. Canonical objects", "", "At minimum: `Person`, `Worker`, `Payslip`.", ""].join("\n")
  assert.deepEqual(canonicalObjects(synthetic), ["Person", "Worker", "Payslip"])

  // `Payslip` is not bound, which is exactly the finding a new object in §4
  // must produce rather than passing unnoticed.
  assert.ok(!("Payslip" in BINDINGS), "the synthetic object must not already be bound")

  const objects = canonicalObjects()
  const unbound = objects.filter((o) => !(o in BINDINGS))
  assert.deepEqual(unbound, [], "The source document names canonical objects this inventory does not bind.")
})

test("the distinction reader reads §2 and every distinction has a verdict", () => {
  const synthetic = [
    "## 2. Core people model",
    "",
    "Keep distinct:",
    "",
    "- `Person` — natural person.",
    "- `Volunteer` — unpaid.",
    "",
    "## 3. Required domain families",
  ].join("\n")
  assert.deepEqual(coreDistinctions(synthetic), ["Person", "Volunteer"])
  assert.ok(!("Volunteer" in DISTINCTIONS), "the synthetic distinction must not already be answered")

  for (const d of coreDistinctions()) {
    assert.ok(d in DISTINCTIONS, `§2 requires \`${d}\` be kept distinct and the inventory does not say whether it is.`)
  }
})

test("the import reader finds real consumers, and none of them is inside the package", () => {
  const importers = importersOf("@tenure/organization-model")
  assert.ok(
    importers.length >= 3,
    `Found ${importers.length} importers of @tenure/organization-model; the specifier reader has stopped working.`,
  )
  for (const i of importers) {
    assert.ok(
      !i.file.startsWith("packages/organization-model/"),
      `${i.file} is inside the package and must not count as reaching it.`,
    )
    assert.ok(i.names.length > 0, `${i.file} was recorded as an importer with no named imports.`)
  }
  // The finding the document reports. A floor rather than an equality, because
  // wiring one of these up is progress and must not have to fight this test —
  // but wiring ALL of them up would mean the document's headline is wrong.
  const reached = new Set(importers.flatMap((i) => i.names))
  const exported = organizationModelExports()
  const unreached = exported.filter((n) => !reached.has(n))
  assert.ok(
    unreached.length > 0,
    "Every exported symbol of the organization model is now reached; the inventory's section 3 finding is stale.",
  )
})

test("every non-ABSENT binding, module and claim names a path that exists", () => {
  const missing = []
  for (const [object, [status, evidence]] of Object.entries(BINDINGS)) {
    if (status === "ABSENT") continue
    if (!exists(evidence)) missing.push(`${object} → ${evidence}`)
  }
  for (const [p] of MODULES) if (!exists(p)) missing.push(`module → ${p}`)
  for (const [p] of CLAIMS) if (!exists(p)) missing.push(`claim → ${p}`)
  for (const [m] of [...PEOPLE_MODELS, ...PEOPLE_MODELS_OFF_CORE]) {
    if (!read("apps/web/prisma/schema.prisma").includes(`model ${m} {`)) missing.push(`model → ${m}`)
  }
  assert.deepEqual(missing, [], "The inventory cites things that are not there.")
})

test("the committed document reports the numbers the tree produces", () => {
  // The generator is the source of these, but a reader believes the markdown.
  // Asserting the headline separately means a hand-edited number reds even if
  // somebody also re-ran the generator afterwards and reintroduced it.
  const doc = fs.readFileSync(path.join(ROOT, OUT), "utf8").split("\r\n").join("\n")
  const objects = canonicalObjects()
  const present = objects.filter((o) => BINDINGS[o][0] === "PRESENT").length
  const partial = objects.filter((o) => BINDINGS[o][0] === "PARTIAL").length
  const absent = objects.filter((o) => BINDINGS[o][0] === "ABSENT").length

  assert.equal(present + partial + absent, objects.length, "an object is bound to a status the summary does not count")
  assert.ok(
    doc.includes(`**Of the ${objects.length} canonical objects: ${present} PRESENT, ${partial} PARTIAL, ${absent} ABSENT.**`),
    "The committed inventory's headline does not match the bindings it lists.",
  )
  assert.ok(doc.includes("<!-- Generated by tools/hcm-people-inventory.mjs. Do not edit by hand. -->"))
})
