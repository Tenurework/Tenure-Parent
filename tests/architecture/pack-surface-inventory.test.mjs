import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { execFileSync } from "node:child_process"

import { test } from "node:test"

import {
  citedPaths,
  JSON_PATH,
  MD_PATH,
  ROOT,
  SCHEMA_SOURCE,
} from "../../tools/pack-surface-inventory.mjs"

/**
 * PACK-000-001 — the inventory is a claim about this repository, and this is
 * what refutes it.
 *
 * An inventory nobody checks is prose. The specific way it fails is not that
 * somebody writes an obviously wrong list — it is that somebody writes a
 * PLAUSIBLE one, assembled from a Bible's own wording, describing modules,
 * routes and tables that no file in the tree contains. That document reads
 * exactly like a correct one and is detected by opening a single path.
 *
 * So every assertion here works on the COMMITTED artefact rather than on a
 * freshly derived one, except the first. Re-deriving and comparing to itself
 * proves the generator is a function; opening the paths proves the document is
 * about this repository.
 */

const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8").replace(/\r\n/g, "\n")
const inventory = JSON.parse(read(JSON_PATH))

test("the committed inventory is what the tree now says", () => {
  // The one re-derivation. `--check` regenerates in memory and byte-compares,
  // so a route added, a model dropped or a provider pack renamed since the last
  // run reds here rather than sitting in a document that reads current.
  execFileSync("node", ["tools/pack-surface-inventory.mjs", "--check"], {
    cwd: ROOT,
    stdio: "pipe",
  })
})

test("every path the inventory cites is a file that exists", () => {
  // The anti-fabrication check, and the reason the generator carries a `source`
  // on every row rather than on every section. A row that names a file nobody
  // has is the exact shape of an invented inventory.
  const missing = citedPaths(inventory).filter((p) => !fs.existsSync(path.join(ROOT, p)))
  assert.deepEqual(
    missing,
    [],
    "The inventory cites files that are not in the tree:\n" +
      missing.join("\n") +
      "\nEither the file was removed and the inventory was not regenerated, or a row " +
      "describes code this repository does not have.",
  )
})

test("no section is empty", () => {
  // A parser that silently stops matching turns every assertion above into a
  // vacuous one — an inventory of nothing cites no missing paths and maps
  // nothing wrongly. Each of the seven the requirement names must be non-empty,
  // by name, so a broken extractor is a failure rather than a shorter table.
  const counts = {
    modules: inventory.modules.length,
    routes: inventory.routes.length,
    schemaModels: inventory.schemaModels.length,
    services: inventory.services.length,
    featureFlags: inventory.featureFlags.flags.length,
    integrations: inventory.integrations.length,
    configurationLayers: inventory.tenantCustomization.configurationLayers.length,
    configurationDomains: inventory.tenantCustomization.configurationDomains.length,
    blueprints: inventory.tenantCustomization.blueprints.length,
  }
  const empty = Object.entries(counts)
    .filter(([, n]) => n === 0)
    .map(([k]) => k)
  assert.deepEqual(empty, [], `Empty inventory sections: ${empty.join(", ")}. Counts: ${JSON.stringify(counts)}`)
})

test("every schema model a module claims is a model the database declares", () => {
  // A mapping, not a paragraph. `modules/index.ts` and `apps/web/prisma/schema.prisma`
  // are written by different hands at different times and nothing before this
  // compared them: a module could claim ownership of a table that was renamed
  // or never existed, and the manifest would still validate, because
  // `validateManifest` checks the manifest's own shape and not the schema.
  const declared = new Set(inventory.schemaModels.map((m) => m.model))
  const orphans = []
  for (const m of inventory.modules) {
    for (const object of m.objects) {
      if (!declared.has(object)) orphans.push(`${m.key} claims ${object}`)
    }
  }
  assert.deepEqual(
    orphans,
    [],
    `A module claims a model ${SCHEMA_SOURCE} does not declare:\n${orphans.join("\n")}`,
  )
  assert.ok(
    inventory.modules.some((m) => m.objects.length > 0),
    "No module claims any object, so this comparison proves nothing.",
  )
})

test("every navigation href a module advertises is a page the tenant app serves", () => {
  // The second half of the same idea, across two independently derived sections
  // of the same document: the module table comes from `modules/index.ts`, the
  // route table from the filesystem. A module advertising a page nobody serves
  // is a nav item that 404s, and it is invisible to type-checking.
  const served = new Set(
    inventory.routes.filter((r) => r.experience === "tenant" && r.kind === "page").map((r) => r.url),
  )
  const dangling = []
  for (const m of inventory.modules) {
    for (const href of m.navigationHrefs) {
      if (!served.has(href)) dangling.push(`${m.key} advertises ${href}`)
    }
  }
  assert.deepEqual(dangling, [], `A module advertises a page the tenant app does not serve:\n${dangling.join("\n")}`)
  assert.ok(
    inventory.modules.some((m) => m.navigationHrefs.length > 0),
    "No module advertises a page, so this comparison proves nothing.",
  )
})

test("the human document and the machine document agree", () => {
  // Two artefacts from one generator, and the headline is the half a person
  // reads. If they can disagree, the number in the summary line is decoration.
  const md = read(MD_PATH)
  const counts = [
    [`${inventory.modules.length} modules`],
    [`${inventory.routes.length} routes`],
    [`${inventory.schemaModels.length} schema models`],
    [`${inventory.services.length} workspaces`],
    [`${inventory.integrations.length} provider packs`],
    [`${inventory.tenantCustomization.configurationDomains.length} configuration domains`],
    [`${inventory.tenantCustomization.blueprints.length} blueprints`],
  ]
  for (const [phrase] of counts) {
    assert.ok(md.includes(phrase), `The markdown headline does not say "${phrase}".`)
  }
})
