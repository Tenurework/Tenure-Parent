import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import path from "node:path"
import { test } from "node:test"

import { ROOT } from "../../tools/ops-operations-inventory.mjs"
import {
  AREAS,
  ARCHETYPES_FILE,
  DISCLAIMERS,
  OUTPUT,
  archetypeAxes,
  areaProblems,
  availabilityFor,
  availabilityUnderSelection,
  build,
  declaredModes,
  entityGroups,
  invocableRelayTools,
  literalArray,
  operationsSuiteModules,
  providerClasses,
  requiredExperiences,
  section,
  servedRoutes,
} from "../../tools/ops-availability-and-limits.mjs"
import { read, schemaDeclarations } from "../../tools/ops-operations-inventory.mjs"

/**
 * OPS-050-001 and OPS-050-005 — the availability decision, and the limitations
 * it publishes.
 *
 * The document under `docs/architecture/ops-availability-and-limitations.md` is
 * generated, so the first job here is the ordinary one: re-derive it and demand
 * byte equality, or the committed file is "current when written, stale when
 * read".
 *
 * The second job is the one that matters more, and it is why this file is longer
 * than a staleness check needs to be. Every interesting assertion about a
 * document that says "nothing is available" passes trivially against a generator
 * that found nothing at all — an empty entity list, an empty route walk, an empty
 * connector scan, and a `availabilityFor` that returns `unavailable` for every
 * input would produce a document that reads exactly like this one and means
 * nothing. So:
 *
 *   * every derived input carries a floor, and the floors are numbers a broken
 *     scan cannot reach;
 *   * `availabilityFor` is driven down BOTH branches against synthetic input, so
 *     an `available` result is proven reachable rather than asserted to be;
 *   * `areaProblems` is driven against synthetic input too, because a detector
 *     that returns `[]` for everything leaves `build()` looking identical and
 *     checking nothing. That has happened in this repository before, which is why
 *     `ops-operations-inventory.mjs` exports its own problem detectors for the
 *     same reason.
 */

const TOOL = path.join(ROOT, "tools", "ops-availability-and-limits.mjs")

test("the committed availability document is what the tree says today", () => {
  execFileSync(process.execPath, [TOOL, "--check"], { cwd: ROOT, stdio: "pipe" })
})

test("build is stable when run twice", () => {
  // A generator that reads a clock, a raw-byte hash or a directory in OS order
  // produces a document that is current on one machine and stale on the next.
  assert.equal(build(), build())
})

test("every derived input clears a floor a broken scan could not", () => {
  const groups = entityGroups()
  const entities = groups.flat()
  assert.ok(groups.length >= 13, `Bible §2 parsed into ${groups.length} entity groups, expected 13+.`)
  assert.ok(entities.length >= 70, `§2 parsed into ${entities.length} entities, expected 70+.`)
  assert.equal(
    new Set(entities).size,
    entities.length,
    "An entity is in two groups. §2 names `Reservation` twice and the groups must dedupe it, " +
      "or every total in the document double-counts.",
  )

  const routes = servedRoutes()
  assert.ok(routes.length >= 30, `Only ${routes.length} tenant routes were found, expected 30+.`)
  assert.ok(routes.includes("/dashboard"), "The route walk no longer finds /dashboard.")

  assert.ok(schemaDeclarations().size >= 60, "The schema parse found fewer than 60 declarations.")
  assert.ok(declaredModes().length >= 5, "Bible §9 declares fewer than 5 manufacturing modes.")
  assert.ok(requiredExperiences().length >= 10, "Bible §17 lists fewer than 10 experiences.")
  assert.ok(providerClasses().length >= 10, "Bible §20 names fewer than 10 provider classes.")
  assert.ok(invocableRelayTools().length >= 1, "No invocable Relay tool was found.")

  const axes = archetypeAxes()
  assert.ok(axes.archetypes.length >= 3, "Fewer than 3 organization archetypes were found.")
  assert.ok(axes.operatingModels.length >= 5, "Fewer than 5 operating models were found.")
  assert.ok(axes.suites.length >= 8, "Fewer than 8 functional suites were found.")
})

test("the composition axes still exclude industry and geography", () => {
  // The document's central claim about jurisdiction rests on this. If somebody
  // adds an IndustryPack or a JurisdictionPack axis, "Operations cannot vary by
  // industry or jurisdiction at all" stops being true, and it must stop being
  // published in the same commit.
  const axes = archetypeAxes().axes
  assert.deepEqual(axes, ["organization", "operatingModel", "functional"])
  assert.ok(!axes.includes("industry"), "An `industry` axis now exists; §3 of the document is stale.")
  assert.ok(!axes.includes("geography"), "A `geography` axis now exists; §3 of the document is stale.")
})

test("the `operations` functional suite is still the collision the document publishes", () => {
  // This is the one finding in the document that is about the product rather
  // than about an absence, so it is the one whose disappearance would matter.
  assert.ok(
    archetypeAxes().suites.includes("operations"),
    `${ARCHETYPES_FILE} no longer offers an \`operations\` functional suite.`,
  )
  assert.deepEqual(
    operationsSuiteModules(),
    ["approvals", "events"],
    "The `operations` suite composes different modules now. The published limitation names them.",
  )
})

test("availability is decided, not returned — both branches are reachable", () => {
  const area = { index: 0, id: "inventory", title: "t", prefix: "/operations/inventory" }
  const entities = ["Lot", "Serial", "InventoryBalance"]
  const declared = (names) => new Map(names.map((n) => [n, { kind: "model", line: 1 }]))

  // (a) nothing declared
  const none = availabilityFor(area, entities, declared([]), [])
  assert.equal(none.status, "unavailable")
  assert.equal(none.condition, "model")
  assert.match(none.reason, /no canonical entity of this area is declared/)

  // (b) some declared — a different reason, with the arithmetic in it
  const partial = availabilityFor(area, entities, declared(["Lot"]), [])
  assert.equal(partial.status, "unavailable")
  assert.equal(partial.condition, "model")
  assert.match(partial.reason, /2 of 3 canonical entities are not declared/)
  assert.deepEqual(partial.missing, ["Serial", "InventoryBalance"])

  // (c) all declared, nothing served — the surface condition, which is the one a
  // schema-only reading of "available" would skip
  const noSurface = availabilityFor(area, entities, declared(entities), ["/dashboard"])
  assert.equal(noSurface.status, "unavailable")
  assert.equal(noSurface.condition, "surface")

  // (d) both conditions met. This is the assertion that stops the function being
  // a constant: `available` is a state the tree can produce.
  const ok = availabilityFor(area, entities, declared(entities), ["/operations/inventory"])
  assert.equal(ok.status, "available")
  assert.equal(ok.condition, null)

  // (e) a nested route counts; a route that merely shares a prefix string does not
  assert.equal(
    availabilityFor(area, entities, declared(entities), ["/operations/inventory/count"]).status,
    "available",
  )
  assert.equal(
    availabilityFor(area, entities, declared(entities), ["/operations/inventory-old"]).status,
    "unavailable",
  )
})

test("a colliding name is not coverage", () => {
  // `Resource` is declared in the tenant schema and is a board resource — a form,
  // a guide, a checklist. Counting it as a work-centre resource is the exact
  // misread `ops-operations-code-inventory.md` §2 exists to prevent, and it would
  // silently move an area from `no canonical entity` to `partial`.
  const area = { index: 1, id: "network", title: "t", prefix: "/operations/network" }
  const verdict = availabilityFor(
    area,
    ["Site", "Resource"],
    new Map([["Resource", { kind: "model", line: 1 }]]),
    [],
  )
  assert.deepEqual(verdict.modelled, [])
  assert.match(verdict.reason, /no canonical entity of this area is declared/)
})

test("the areas the document publishes are the verdicts the tree yields", () => {
  const groups = entityGroups()
  const declarations = schemaDeclarations()
  const routes = servedRoutes()
  const doc = read(OUTPUT)

  for (const [index, id, title, prefix] of AREAS) {
    const verdict = availabilityFor({ index, id, title, prefix }, groups[index], declarations, routes)
    assert.ok(
      doc.includes(`- \`${id}\` — ${verdict.reason}.`),
      `${OUTPUT} does not carry the derived reason for \`${id}\`: ${verdict.reason}`,
    )
    assert.ok(
      doc.includes(`| ${title} | ${index} | ${groups[index].length} | ${verdict.modelled.length} |`),
      `${OUTPUT} does not carry the derived row for \`${id}\`.`,
    )
  }
})

test("no area is published available while its model is absent", () => {
  // The direction that must never drift. Everything else here would survive an
  // overclaim; this is the assertion that refuses one.
  const groups = entityGroups()
  const declarations = schemaDeclarations()
  const routes = servedRoutes()
  const overclaimed = AREAS.filter(([index, id, title, prefix]) => {
    const v = availabilityFor({ index, id, title, prefix }, groups[index], declarations, routes)
    return v.status === "available" && v.missing.length > 0
  })
  assert.deepEqual(overclaimed, [], "An area is available with entities missing. The rule is both conditions.")
})

test("a selection is resolved, and a question the platform cannot answer is refused", () => {
  const axes = archetypeAxes()
  const fixed = {
    axes,
    declarations: schemaDeclarations(),
    routes: servedRoutes(),
    groups: entityGroups(),
  }

  const answered = availabilityUnderSelection(
    { archetype: axes.archetypes[0], operatingModel: axes.operatingModels[0] },
    fixed,
  )
  assert.equal(answered.ok, true)
  assert.equal(answered.areas.length, AREAS.length)
  assert.deepEqual(answered.available, [])

  // Refused, not answered. Every one of these would otherwise come back
  // `unavailable`, which reads as "we checked" about a system nobody can select
  // and a jurisdiction nobody can look up.
  assert.equal(
    availabilityUnderSelection({ archetype: "manufacturing", operatingModel: axes.operatingModels[0] }, fixed)
      .refusal,
    "unknown-archetype",
  )
  assert.equal(
    availabilityUnderSelection({ archetype: axes.archetypes[0], operatingModel: "hierarchical" }, fixed)
      .refusal,
    "unknown-operating-model",
  )
  const jurisdiction = availabilityUnderSelection(
    { archetype: axes.archetypes[0], operatingModel: axes.operatingModels[0], jurisdiction: "DE" },
    fixed,
  )
  assert.equal(jurisdiction.refusal, "no-jurisdiction-axis")
  assert.equal(jurisdiction.areas, undefined, "A refusal must not also carry an answer.")
  assert.match(jurisdiction.detail, /would imply somebody checked/)

  // And when a geography axis DOES exist, the same question is answered rather
  // than refused. Without this the refusal is indistinguishable from a function
  // that refuses every jurisdiction forever.
  const withGeography = availabilityUnderSelection(
    { archetype: axes.archetypes[0], operatingModel: axes.operatingModels[0], jurisdiction: "DE" },
    { ...fixed, axes: { ...axes, axes: [...axes.axes, "geography"] } },
  )
  assert.equal(withGeography.ok, true)
})

test("every safety disclaimer is a literal sentence of the section it cites", () => {
  for (const [n, quote] of DISCLAIMERS) {
    assert.ok(
      section(n).includes(quote),
      `The disclaimer attributed to Bible §${n} is not in that section: ${quote}`,
    )
    assert.ok(read(OUTPUT).includes(quote), `${OUTPUT} does not carry the §${n} disclaimer.`)
  }
  assert.ok(DISCLAIMERS.length >= 4, "Fewer than four safety disclaimers are published.")
})

test("the drift detector detects, against input it has never seen", () => {
  const bible = read("Tenure_Operations_Supply_Manufacturing_and_Service_Cloud_Claude_Bible_v1.0.md")
  const groups = [["A"], ["B"], ["C"]]
  const ok = [
    [0, "a", "A", "/operations/a"],
    [1, "b", "B", "/operations/b"],
    [2, "c", "C", "/operations/c"],
  ]
  assert.deepEqual(areaProblems(ok, groups, bible), [])

  const fewer = areaProblems(ok.slice(0, 2), groups, bible)
  assert.ok(
    fewer.some((p) => /3 entity bullets and AREAS describes 2/.test(p)),
    `A new §2 bullet must be refused, got: ${fewer.join(" | ")}`,
  )

  const duplicatedIndex = areaProblems(
    [ok[0], [0, "b", "B", "/operations/b"], ok[2]],
    groups,
    bible,
  )
  assert.ok(
    duplicatedIndex.some((p) => /Two areas claim §2 bullet 0/.test(p)),
    `Two areas on one bullet must be refused, got: ${duplicatedIndex.join(" | ")}`,
  )

  const duplicatedPrefix = areaProblems(
    [ok[0], [1, "b", "B", "/operations/a"], ok[2]],
    groups,
    bible,
  )
  assert.ok(
    duplicatedPrefix.some((p) => /Two areas claim the prefix \/operations\/a/.test(p)),
    `Two areas on one prefix must be refused, got: ${duplicatedPrefix.join(" | ")}`,
  )

  const badPrefix = areaProblems([ok[0], [1, "b", "B", "operations/b"], ok[2]], groups, bible)
  assert.ok(
    badPrefix.some((p) => /unusable route prefix/.test(p)),
    `A prefix that is not a path must be refused, got: ${badPrefix.join(" | ")}`,
  )

  const noTitle = areaProblems([ok[0], [1, "b", "  ", "/operations/b"], ok[2]], groups, bible)
  assert.ok(
    noTitle.some((p) => /has no title/.test(p)),
    `An untitled area must be refused, got: ${noTitle.join(" | ")}`,
  )

  // And the disclaimer check, on a Bible that does not say it.
  const rewritten = bible.replace(
    "Sensitive/dangerous operational commands require step-up/SoD/approval.",
    "Sensitive commands are fine.",
  )
  const drifted = areaProblems(ok, groups, rewritten)
  assert.ok(
    drifted.some((p) => /The disclaimer quoted from §16 is not in that section/.test(p)),
    `A disclaimer the Bible no longer states must be refused, got: ${drifted.join(" | ")}`,
  )
})

test("the literal-array reader reads arrays rather than files", () => {
  // Proven against synthetic TypeScript, because every call in the generator is
  // against one file and a reader that returned [] for a renamed export would
  // make three floors above unreachable rather than failing here.
  const sample = 'export const THINGS = ["one", "two"] as const\nexport const OTHER = ["x"] as const\n'
  assert.deepEqual(literalArray("THINGS", sample), ["one", "two"])
  assert.deepEqual(literalArray("OTHER", sample), ["x"])
  assert.throws(() => literalArray("MISSING", sample), /no longer exported as a literal array/)
})
