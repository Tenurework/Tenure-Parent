import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { test } from "node:test"

import { BINDINGS, ROOT, canonicalObjects } from "../../tools/hcm-people-inventory.mjs"
import {
  FAMILY_OBJECTS,
  availabilityFrom,
  FAMILY_SURFACE,
  OUT,
  capabilityFamilies,
  connectorPacks,
  familyVerdict,
  jurisdictionPackFiles,
  payrollModes,
  providerCoverage,
  render,
  tenantRoutes,
  verify,
} from "../../tools/hcm-capability-matrix.mjs"

/**
 * HCM-050-005 — the published capability/jurisdiction/provider matrix is what the
 * tree says, and says nothing the tree does not.
 *
 * A published matrix is only worth anything if it cannot quietly go wrong, and
 * there are three ways it can: the committed document drifts from the generator;
 * the generator's own bindings drift from the Bible; or an availability claim
 * appears without the readiness behind it. Each has its own test below.
 *
 * The generator is the thing under test, not this file — every assertion here
 * calls the same functions the document is rendered from, so a guard passing
 * cannot mean anything different from the document being right.
 */

function committed() {
  return fs.readFileSync(path.join(ROOT, OUT), "utf8").replace(/\r\n/g, "\n")
}

test("the committed matrix is what the generator produces now", () => {
  assert.equal(
    committed(),
    render(),
    `${OUT} is stale. Run \`node tools/hcm-capability-matrix.mjs\`. A hand-edited row is the ` +
      `failure this whole file exists to catch: the document is what somebody reads to answer ` +
      `"can this tenant do payroll", and an edit to it is a capability claim with nothing behind it.`,
  )
})

test("the generator's own bindings still hold", () => {
  const problems = verify()
  assert.deepEqual(
    problems,
    [],
    `the matrix's derivations no longer hold:\n  ${problems.join("\n  ")}`,
  )
})

test("every capability family the Bible states has a row", () => {
  const families = capabilityFamilies()
  // Asserted as a number first: a heading parser that matched nothing would make
  // every comparison below iterate an empty list and pass.
  assert.equal(
    families.length,
    10,
    `Parsed ${families.length} §3 capability families from the People Bible. It states 10 ` +
      `(§3.1 … §3.10); another number means the heading shape changed and this matrix is now ` +
      `measuring something else.`,
  )
  for (const f of families) {
    assert.ok(
      committed().includes(`| ${f.number} | ${f.title} |`),
      `§${f.number} "${f.title}" has no row in ${OUT}.`,
    )
  }
})

test("every canonical object is accounted for by exactly one family", () => {
  const objects = canonicalObjects()
  assert.equal(
    objects.length,
    45,
    `§4 parsed ${objects.length} canonical objects, not 45. The object sentence changed.`,
  )
  const counts = new Map(objects.map((o) => [o, 0]))
  for (const names of Object.values(FAMILY_OBJECTS)) {
    for (const name of names) counts.set(name, (counts.get(name) ?? 0) + 1)
  }
  const wrong = [...counts].filter(([, n]) => n !== 1).map(([name, n]) => `${name} → ${n} families`)
  assert.deepEqual(
    wrong,
    [],
    `objects bound to no family or to more than one:\n  ${wrong.join("\n  ")}\n` +
      `An object bound to nothing is a capability nobody's row reports on, which is how a family ` +
      `comes to look complete because the missing part of it was never listed.`,
  )
})

test("the availability rule refuses AVAILABLE unless all three conditions hold", () => {
  // Exercised over inputs the tree does not currently produce, on purpose. No
  // family is AVAILABLE today, so walking the ten families would assert this
  // vacuously and the guard would read as coverage while being unable to fail.
  const complete = { present: 4, partial: 0, absent: 0, surface: "admin/people", certified: true }
  assert.equal(availabilityFrom(complete), "AVAILABLE")

  assert.equal(
    availabilityFrom({ ...complete, certified: false }),
    "LIMITED",
    "every object present and a surface, but no certification decision on disk — that is not AVAILABLE.",
  )
  assert.equal(
    availabilityFrom({ ...complete, absent: 1 }),
    "LIMITED",
    "a missing canonical object cannot be certified away.",
  )
  assert.equal(
    availabilityFrom({ ...complete, partial: 1 }),
    "LIMITED",
    "PARTIAL means something a reader could mistake for the object; it is not the object.",
  )
  assert.equal(
    availabilityFrom({ ...complete, surface: null }),
    "UNAVAILABLE",
    "a capability with no surface cannot be reached at all, whatever exists behind it.",
  )
  assert.equal(
    availabilityFrom({ present: 0, partial: 0, absent: 6, surface: null, certified: false }),
    "UNAVAILABLE",
  )
})

test("nothing is claimed AVAILABLE without the objects, a surface and an ADR on disk", () => {
  for (const number of Object.keys(FAMILY_OBJECTS)) {
    const v = familyVerdict(number)
    if (v.availability !== "AVAILABLE") continue
    assert.equal(v.absent.length, 0, `§${number} is AVAILABLE with ${v.absent.length} absent objects.`)
    assert.equal(v.partial.length, 0, `§${number} is AVAILABLE with ${v.partial.length} partial objects.`)
    assert.notEqual(v.surface, null, `§${number} is AVAILABLE with no surface.`)
    assert.ok(
      fs.existsSync(path.join(ROOT, v.certification)),
      `§${number} is AVAILABLE and ${v.certification} is not a file in this repository. A ` +
        `provider or a partial build is not a certification.`,
    )
  }
})

test("a declared surface is a route that exists", () => {
  const routes = tenantRoutes()
  assert.ok(routes.length > 20, `Found ${routes.length} tenant routes; the walker is broken.`)
  for (const [number, surface] of Object.entries(FAMILY_SURFACE)) {
    if (surface === null) continue
    assert.ok(
      routes.includes(surface),
      `§${number} claims the surface \`${surface}\`, which is not one of the ${routes.length} routes ` +
        `under apps/web/src/app/(app). A capability whose surface does not exist is not limited; it ` +
        `is unavailable.`,
    )
  }
})

test("the payroll section reports the mode the tree supports, which is UNAVAILABLE", () => {
  const modes = payrollModes()
  assert.deepEqual(modes, [
    "UNAVAILABLE",
    "EXPORT_ONLY",
    "PROVIDER_ORCHESTRATED",
    "SHADOW",
    "TENURE_NATIVE_CERTIFIED",
  ])
  // The three payroll objects must all be ABSENT for `UNAVAILABLE` to be the
  // honest answer. If one of them ever exists, this reds and the section has to
  // be re-decided rather than continuing to read the same way.
  for (const name of FAMILY_OBJECTS["3.10"]) {
    assert.equal(
      BINDINGS[name]?.[0],
      "ABSENT",
      `${name} is no longer ABSENT, so "no payroll object in the schema" is no longer true and ` +
        `the payroll mode section is asserting something it has not checked.`,
    )
  }
  assert.ok(
    committed().includes("A generated file is never a payment and never a filing."),
    `${OUT} must keep §3.10's own rule — "Never imply that a generated file equals paid or filed".`,
  )
})

test("no People provider domain is reported as covered while the catalog has no connector for it", () => {
  const packs = connectorPacks()
  assert.ok(
    packs.length > 0,
    `Parsed 0 connector packs. A parser that finds nothing reports every provider domain as ` +
      `uncovered for the wrong reason, and "we could not look" is not "we looked and found nothing".`,
  )
  for (const { domain, matched } of providerCoverage(packs)) {
    const row = committed()
      .split("\n")
      .find((l) => l.startsWith(`| ${domain} |`))
    assert.ok(row, `no provider row for ${domain} in ${OUT}.`)
    if (matched.length === 0) {
      assert.ok(row.includes("**none**"), `${domain} has no connector and the row does not say so.`)
    } else {
      for (const key of matched) {
        assert.ok(row.includes(key), `${domain} is served by \`${key}\` and the row omits it.`)
      }
    }
  }
})

test("the jurisdiction section states the result of a search that was actually run", () => {
  const found = jurisdictionPackFiles()
  const text = committed()
  if (found.length === 0) {
    assert.ok(
      text.includes("Found: none. No jurisdiction pack exists"),
      `no jurisdiction pack is in the tree and ${OUT} does not say so.`,
    )
  } else {
    for (const f of found) {
      assert.ok(text.includes(f), `${f} is a jurisdiction pack in the tree and ${OUT} omits it.`)
    }
  }
})
