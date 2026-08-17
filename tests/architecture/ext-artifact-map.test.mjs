import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { test } from "node:test"

import { ROOT } from "../../tools/document-graph.mjs"
import {
  KINDS,
  UNRESOLVED_CONFLICTS,
  canonicalObjects,
  conflicts,
  duplicateDecisionNumbers,
  resolveArtifactMap,
} from "../../tools/ext-artifact-map.mjs"

/**
 * EXT-000-003 — every kind of artifact the requirement names is mapped to a
 * canonical object, and the places two artifacts claim one fact are named.
 *
 * *"Existing implementation/migration/localization/payroll/bank/cutover/support
 * artifacts are mapped to canonical objects; conflicting sources of truth are
 * identified."*
 *
 * The object names are parsed out of §3.2 of the extension rather than typed
 * here, so a mapping onto an object the authority does not define reds this
 * file. The kinds are taken from the requirement's own statement for the same
 * reason. What is left to judgement is which object a given artifact IS, and
 * that judgement is recorded next to it in a sentence somebody can disagree
 * with.
 */

const REGISTRY = "docs/architecture/capability-completeness-registry.yaml"

test("the seven kinds are the seven the requirement names", () => {
  const statement = fs
    .readFileSync(path.join(ROOT, REGISTRY), "utf8")
    .split(/\r?\n/)
    .find((l) => l.includes("artifacts are mapped to canonical objects"))
  assert.ok(statement, `EXT-000-003's statement was not found in ${REGISTRY}`)

  assert.equal(KINDS.length, 7)
  for (const k of KINDS) {
    assert.ok(statement.includes(k.word), `"${k.word}" is declared as a kind and is not in the statement`)
  }
})

test("§3.2 defines the objects, and every mapping names one of them", () => {
  const objects = canonicalObjects()
  // Sixteen, read from the authority's table. Asserted so that a parse that
  // silently returned nothing would fail here rather than make the next
  // assertion vacuous.
  assert.equal(objects.length, 16, `§3.2 parsed to ${objects.length} objects`)
  assert.ok(objects.includes("ImplementationProgram") && objects.includes("DecommissionRecord"))

  const wrong = []
  for (const k of resolveArtifactMap()) {
    for (const r of k.rules) {
      if (!objects.includes(r.canonical)) wrong.push(`${k.kind}/${r.rule} → ${r.canonical}`)
    }
  }
  assert.deepEqual(wrong, [], `mapped onto something §3.2 does not define:\n  ${wrong.join("\n  ")}`)
})

test("every mapped artifact is on disk, and every rule finds something", () => {
  const problems = []
  for (const k of resolveArtifactMap()) {
    for (const r of k.rules) {
      // A rule that finds nothing is a rule pointing at a file somebody moved.
      // Silence there would shrink the map without shrinking the claim.
      if (r.artifacts.length === 0) problems.push(`${k.kind}/${r.rule} discovers nothing`)
      for (const a of r.artifacts) {
        if (!fs.existsSync(path.join(ROOT, a))) problems.push(`${k.kind}/${r.rule}: ${a} is not here`)
      }
      if ((r.why ?? "").length < 60) problems.push(`${k.kind}/${r.rule} maps without saying why`)
    }
  }
  assert.deepEqual(problems, [], `\n  ${problems.join("\n  ")}`)
})

test("a kind with no artifact says so, and a kind with one does not", () => {
  const problems = []
  for (const k of resolveArtifactMap()) {
    const found = k.rules.reduce((n, r) => n + r.artifacts.length, 0)
    if (found === 0 && (k.absent ?? "").length < 80) {
      problems.push(`${k.kind}: nothing found and no reason recorded`)
    }
    if (found > 0 && k.absent !== null) {
      problems.push(`${k.kind}: ${found} artifact(s) found and it still claims absence`)
    }
  }
  assert.deepEqual(problems, [], `\n  ${problems.join("\n  ")}`)
})

test("conflicting sources of truth are identified, each naming the files", () => {
  const found = conflicts()
  assert.ok(found.length > 0, "the scan found no conflicts, which this repository is known not to be")
  for (const c of found) {
    assert.ok(c.conflict.length > 10, `a conflict with no description: ${JSON.stringify(c)}`)
    assert.ok(c.paths.length > 0, `${c.conflict} names no file`)
    for (const p of c.paths) {
      assert.ok(fs.existsSync(path.join(ROOT, p)), `${c.conflict} names ${p}, which is not here`)
    }
  }

  // The one this scan found that nothing else in the repository had: two
  // accepted decision records issued the number every citation of "ADR-0008"
  // resolves to.
  assert.ok(
    found.some((c) => /numbered adr-0008/.test(c.conflict) && c.resolution === null),
    "the ADR-0008 number collision is no longer reported — if it was resolved, lower UNRESOLVED_CONFLICTS",
  )
})

test("the duplicate-number detector fires on a collision and not on a series", () => {
  assert.deepEqual(
    duplicateDecisionNumbers([
      "docs/decisions/ADR-0008-b.md",
      "docs/decisions/ADR-0008-a.md",
      "docs/decisions/ADR-0009-x.md",
    ]),
    [["adr-0008", ["docs/decisions/ADR-0008-a.md", "docs/decisions/ADR-0008-b.md"]]],
  )
  // Different series, same number, and not a collision: `pay-adr-0001` and
  // `ADR-0001` are cited differently and resolve to different documents.
  assert.deepEqual(
    duplicateDecisionNumbers(["docs/decisions/ADR-0001-a.md", "docs/decisions/pay-adr-0001-b.md"]),
    [],
  )
  assert.deepEqual(duplicateDecisionNumbers(["docs/decisions/README.md"]), [])
})

test("the unresolved-conflict count may only shrink", () => {
  const unresolved = conflicts().filter((c) => c.resolution === null)
  assert.equal(
    unresolved.length,
    UNRESOLVED_CONFLICTS,
    unresolved.length > UNRESOLVED_CONFLICTS
      ? `${unresolved.length} conflicts have no recorded resolution and the map admits ` +
          `${UNRESOLVED_CONFLICTS}:\n  ${unresolved.map((c) => c.conflict).join("\n  ")}`
      : `only ${unresolved.length} are unresolved and the map still admits ${UNRESOLVED_CONFLICTS}. ` +
          `Lower UNRESOLVED_CONFLICTS — a ratchet that is not tightened stops measuring.`,
  )
})
