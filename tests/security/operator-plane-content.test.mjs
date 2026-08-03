import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"

/**
 * GE-033-002 — the operator plane has no default raw content access.
 *
 * The item lists ten fleet views and ends with the clause that governs all of
 * them: fleet health, lifecycle, release, migration, connectors, identity,
 * backup, security, cost and incident views "**without default raw content
 * access**".
 *
 * `cell-independence` already stops the CELL importing the engine. Nothing
 * stopped the reverse, and the reverse is the one with a customer's data on the
 * other side of it: an operator console that imported Prisma would be one query
 * away from reading a student's record while rendering a page about tenant
 * health.
 *
 * ## Why this is a guard and not a review note
 *
 * Every fleet view is a request for information about a tenant, and the
 * cheapest way to answer any of them is to read the tenant's database. The
 * pressure is toward crossing this line, one reasonable-looking query at a
 * time, and each one will have a good reason. The Studio holds the registry in
 * DynamoDB and has no connection to any cell's Postgres — this is what keeps
 * that true.
 *
 * Support access to real content is a different thing with its own controls
 * (GE-033-003: ticket, tenant approval, narrow scope, time limit, step-up,
 * banner, dual attribution, revocation, audit). "Default" is the word doing the
 * work in the requirement — not "never", but "not simply by opening a page".
 */

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, "../..")
const STUDIO = "apps/system-studio/src"

function grep(pattern, ...paths) {
  try {
    return execFileSync("git", ["grep", "-lE", "--untracked", pattern, "--", ...paths], {
      cwd: ROOT,
      encoding: "utf8",
    })
      .split("\n")
      .filter(Boolean)
      .filter((f) => !/\.(test|itest|spec)\.[cm]?[jt]sx?$/.test(f))
  } catch (err) {
    if (err.status !== 1) throw err
    return []
  }
}

test("the operator console has no database client for tenant content", () => {
  // Prisma is how tenant content is read anywhere in this repository. A single
  // import inside the Studio would put every business table one call away from
  // a page about fleet health.
  const importers = grep("@prisma/client|from \"@/lib/db\"|PrismaClient", `${STUDIO}/*`)
  assert.deepEqual(
    importers,
    [],
    `the operator console imports a tenant database client:\n` +
      importers.map((f) => `  ${f}`).join("\n") +
      `\n\nThe console answers operational questions from the registry. Reading tenant content ` +
      `needs the support-session controls in GE-033-003, not a query.`,
  )
})

test("the operator console does not depend on the cell's application package", () => {
  // `apps/web` is the cell. Importing from it would reach its data layer
  // transitively, whatever the import looked like at the call site.
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "apps/system-studio/package.json"), "utf8"))
  const dependencies = { ...pkg.dependencies, ...pkg.devDependencies }

  assert.ok(
    !Object.keys(dependencies).some((d) => d === "tenure" || d.startsWith("@tenure/web")),
    `the console depends on the cell application: ${Object.keys(dependencies).join(", ")}`,
  )
  assert.ok(
    !("prisma" in dependencies || "@prisma/client" in dependencies),
    "the console declares a Prisma dependency; it has no tenant database to talk to",
  )
})

/**
 * Source with comments removed.
 *
 * Every lexical guard in this repository has at some point fired on the comment
 * explaining the rule it enforces — three times in one session, including on
 * this file. Rewording the prose each time treats the symptom: a guard that
 * cannot tell code from an explanation punishes explaining, and the explanation
 * is usually the most valuable line in the file. Scanning code only is the fix.
 */
function code(file) {
  return fs
    .readFileSync(path.join(ROOT, file), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1")
}

test("fleet health is derived from operational facts, not from content", () => {
  // The positive half. A health module that reached for a business record would
  // pass the import checks above if it did so through a fetch, so this asserts
  // what its CODE actually touches.
  const source = code(`${STUDIO}/lib/fleet-health.ts`)

  for (const forbidden of ["fetch\\(", "prisma", "student", "member", "document", "message"]) {
    assert.ok(
      !new RegExp(forbidden, "i").test(source),
      `fleet-health.ts reaches for "${forbidden}". Health is derived from lifecycle state, ` +
        `timestamps, deployment presence and config revision — all of which the control plane ` +
        `already owns.`,
    )
  }
})

test("the pattern matches a genuine Prisma import", () => {
  // A guard for an absence has to be shown catching something, or it is
  // indistinguishable from a grep that matches nothing because it is wrong.
  //
  // Proven against real committed code rather than a probe file written into
  // the tree. Writing one made every tree-scanning guard that happened to run
  // beside it intermittently wrong: `ownership-map.mjs --check` sees an extra
  // file, reports the committed map as stale, and `test:platform` went red in
  // roughly one run in four with a message pointing at the map. Real code is a
  // better witness anyway — a synthetic import proves the pattern matches what
  // this test wrote; this proves it matches what the platform writes.
  const found = grep("@prisma/client|from \"@/lib/db\"|PrismaClient", "apps/web/src")
  assert.ok(
    found.length > 0,
    "the pattern does not match a genuine Prisma import anywhere in apps/web, so the checks " +
      "above prove nothing.",
  )
})

test("the studio path the checks scan is a live one", () => {
  // The other half of what the probe used to show: the pattern is right *and*
  // the pathspec reaches real files. A glob that matched nothing would make
  // every absence check above vacuously true.
  const anyImport = grep("^import ", `${STUDIO}/*`)
  assert.ok(
    anyImport.length > 10,
    `"${STUDIO}/*" matched ${anyImport.length} file(s) containing an import. The pathspec has ` +
      `stopped reaching the studio's sources, which makes every check above pass by finding nothing.`,
  )
})
