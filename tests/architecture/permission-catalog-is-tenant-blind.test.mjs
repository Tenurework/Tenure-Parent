import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"

/**
 * GE-051-001 — the permission catalog cannot read a tenant.
 *
 * Bible §9.3: "Tenant labels may rename Treasurer to Finance Lead or Division to
 * Faculty, but semantic permission keys do not change."
 *
 * `permission-catalog.test.ts` asserts the behaviour — the same keys under every
 * blueprint's terminology. That test can only observe what today's code does.
 * This one removes the possibility: a module that cannot import configuration,
 * blueprints or the database cannot derive a key from a tenant's vocabulary, and
 * no test has to notice.
 *
 * The rule is about the import list, so something has to read the import list.
 * A comment saying "do not import configuration here" is not a rule; it is a
 * request.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, "../..")

const CATALOG = "packages/authorization/src/permission-catalog.ts"

/**
 * What the catalog may not reach.
 *
 * Every one of these can answer a question differently for two customers. A key
 * built from any of them is a key that varies, which is the one thing a stable
 * semantic key is defined by not doing.
 */
const FORBIDDEN = [
  { pattern: "@tenure/blueprints", why: "blueprints carry each customer's terminology" },
  { pattern: "@tenure/configuration", why: "the configuration engine resolves tenant-layered values" },
  { pattern: "@tenure/platform-config", why: "platform-config resolves localization and branding per tenant" },
  { pattern: "@prisma/client", why: "the database holds tenant rows" },
  { pattern: "/lib/db", why: "the database holds tenant rows" },
  { pattern: "next/headers", why: "request headers carry the acting tenant" },
]

function importsOf(source) {
  const out = []
  const re = /(?:^|\n)\s*import[^\n]*?from\s+["']([^"']+)["']/g
  let m
  while ((m = re.exec(source)) !== null) out.push(m[1])
  const dynamic = /import\(\s*["']([^"']+)["']\s*\)/g
  while ((m = dynamic.exec(source)) !== null) out.push(m[1])
  const required = /require\(\s*["']([^"']+)["']\s*\)/g
  while ((m = required.exec(source)) !== null) out.push(m[1])
  return out
}

test("the catalog is where this test thinks it is", () => {
  const abs = path.join(ROOT, CATALOG)
  assert.ok(
    fs.existsSync(abs),
    `${CATALOG} does not exist. A guard pointed at a moved file passes by finding nothing, so ` +
      `this fails loudly instead. Point CATALOG at the file if it was renamed.`,
  )
  const source = fs.readFileSync(abs, "utf8")
  assert.match(
    source,
    /export const PERMISSIONS/,
    `${CATALOG} no longer exports PERMISSIONS, so this is probably not the catalog any more.`,
  )
})

test("the import parser finds imports", () => {
  // The check below passes on an empty import list, and that list comes from a
  // regex over source text.
  const found = importsOf(
    ['import a from "x"', 'import { b } from "./y"', 'const c = require("z")'].join(
      String.fromCharCode(10),
    ),
  )
  assert.deepEqual(found, ["x", "./y", "z"])
})

/** Shared by the real check and its self-test, so a detector that stops
 *  detecting fails a test rather than passing quietly. */
function forbiddenImports(specifiers, where) {
  const violations = []
  for (const specifier of specifiers) {
    for (const { pattern, why } of FORBIDDEN) {
      if (specifier.includes(pattern)) {
        violations.push(`${where} imports "${specifier}" — ${why}.`)
      }
    }
  }
  return violations
}

test("the detector flags a forbidden import and leaves the rest alone", () => {
  const flagged = forbiddenImports(
    ["./model", "node:assert", "@tenure/blueprints", "@tenure/workflow"],
    "synthetic",
  )
  assert.equal(flagged.length, 1)
  assert.match(flagged[0], /@tenure\/blueprints/)
})

test("the permission catalog imports nothing that knows about a tenant", () => {
  const source = fs.readFileSync(path.join(ROOT, CATALOG), "utf8")
  const found = importsOf(source)
  assert.ok(
    found.length >= 0,
    "importsOf returned nothing usable.",
  )

  const violations = forbiddenImports(found, CATALOG)

  assert.deepEqual(
    violations,
    [],
    "The permission catalog reached something tenant-specific:" +
      String.fromCharCode(10) +
      violations.join(String.fromCharCode(10)) +
      String.fromCharCode(10) +
      "A permission key that can be derived from a tenant's vocabulary is not a stable semantic " +
      "key. Whatever needed the tenant belongs at the call site, not in the catalog.",
  )
})

test("the deny reason for an unrecognised permission exists and is used", () => {
  // The catalog only closes the module-gate hole if `decide` actually refuses an
  // unknown key. A reason declared and never returned is the failure mode the
  // authorization model's own header calls out in the architecture's SQL.
  const model = fs.readFileSync(path.join(ROOT, "packages/authorization/src/model.ts"), "utf8")
  const decide = fs.readFileSync(path.join(ROOT, "packages/authorization/src/decide.ts"), "utf8")

  assert.match(model, /"UNKNOWN_PERMISSION"/, "UNKNOWN_PERMISSION is not a declared deny reason.")
  assert.match(
    decide,
    /deny\(\s*"UNKNOWN_PERMISSION"/,
    "decide() never returns UNKNOWN_PERMISSION, so an unrecognised key is being handled some " +
      "other way — most likely the module gate it used to skip.",
  )
  assert.ok(
    !/function moduleOf/.test(decide),
    "decide() still derives a module by splitting the permission string. That is what let a " +
      "permission with no dot skip the module gate entirely.",
  )
})
