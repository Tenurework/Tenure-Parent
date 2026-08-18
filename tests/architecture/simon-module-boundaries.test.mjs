import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { test } from "node:test"

import {
  INVARIANTS,
  KNOWN_TENANT_REGISTRY_IMPORTS,
  ROOT,
  TENANT_CONFIG_ENTRY,
  analyse,
  cyclesOf,
  importsOf,
  stripComments,
  tenantSpecificExports,
  tenantTokens,
} from "../../tools/simon-module-boundaries.mjs"

/**
 * SIMON-010-005, SIMON-010-008 and SIMON-100-013 — the module boundary, the
 * tenant-configuration boundary, and the CI rules that keep them.
 *
 * Every case here asserts a PROPERTY of the tree, never a snapshot of it. This
 * repository is edited by many people at once and a guard that reds because
 * somebody added an unrelated import is a guard that gets deleted. The
 * generated document (`docs/architecture/simon-module-boundaries.md`) is the
 * readable half and is not asserted equal to anything.
 *
 * Two of the three requirements are FAIL in
 * `docs/implementation/simon-ose-absorption-execution-ledger.md`, and that is
 * recorded there rather than softened here: two generic core packages still
 * import the tenant registry. The guards below are what stops the boundary
 * getting worse in the meantime, and the last of them is what fails if the
 * dangerous version of that import — the one that also names the tenant —
 * appears.
 */

const a = analyse()

test("the analyser names exactly the invariants this file asserts", () => {
  // A meta-case, because the failure it catches is silent: an invariant added
  // to the tool and never asserted reads, from the document, as enforced.
  const asserted = [
    "acyclic-production-imports",
    "no-deep-cross-workspace-imports",
    "no-direct-table-access",
    "no-per-tenant-path-import-from-core",
    "tenant-registry-imports-only-shrink",
    "no-simon-aware-core-file",
    "no-tenant-named-core-module",
  ]
  assert.deepEqual([...INVARIANTS].sort(), asserted.sort())
})

test("the import scanner reads code and not comments", () => {
  // Not decoration. `packages/provisioning/src/manifest.ts` mentions
  // `@tenure/blueprints` twice, both times in a comment saying it deliberately
  // does NOT import it. A scanner that reads comments records that file as a
  // boundary violation, and the violation is the comment denying it.
  const sample = [
    '// import { TENANT_BINDINGS } from "@tenure/blueprints"',
    '/* import x from "@tenure/audit" */',
    'import { real } from "@tenure/contracts"',
  ].join("\n")
  const found = importsOf(sample).map((i) => i.specifier)
  assert.deepEqual(found, ["@tenure/contracts"])
  assert.ok(!stripComments(sample).includes("@tenure/blueprints"))

  // And the real file, which is the case that motivated it.
  const manifest = "packages/provisioning/src/manifest.ts"
  const text = fs.readFileSync(path.join(ROOT, manifest), "utf8")
  assert.ok(text.includes("@tenure/blueprints"), `${manifest} no longer mentions blueprints — re-point this case`)
  assert.ok(
    !importsOf(text).some((i) => i.specifier.startsWith("@tenure/blueprints")),
    `${manifest} now really imports blueprints — that is a finding, not a broken test`,
  )
})

test("the cycle finder finds a cycle", () => {
  // The acyclic case below passes when the tree is clean AND when the finder is
  // broken. This is the difference.
  assert.deepEqual(cyclesOf({ a: ["b"], b: ["a"] }, ["a", "b"]), ["a -> b -> a"])
  assert.deepEqual(cyclesOf({ a: ["b"], b: [] }, ["a", "b"]), [])
})

test("SIMON-010-005 — the production import graph of the shared code is acyclic", () => {
  assert.ok(a.nodes.length >= 14, `read only ${a.nodes.length} workspaces — the listing is broken, not the code`)
  assert.ok(
    Object.values(a.graph.prod).some((s) => s.size > 0),
    "no cross-workspace production imports found at all — the scanner is broken",
  )
  assert.deepEqual(
    a.prodCycles,
    [],
    "these shared packages import each other in a circle, so neither can be loaded, tested or " +
      `reasoned about without the other:\n${a.prodCycles.join("\n")}`,
  )
  // A DAG is what makes a tier meaningful, so every workspace has one.
  const untiered = Object.entries(a.tiers).filter(([, t]) => t === null || t === undefined)
  assert.deepEqual(untiered.map(([n]) => n), [], "these workspaces have no dependency tier")
})

test("SIMON-010-005 — no production import reaches past a workspace's declared entry point", () => {
  assert.deepEqual(
    a.deepImports.map((d) => `${d.file}:${d.line} — ${d.specifier}`),
    [],
    "a subpath import is legal only where the target manifest declares it in `exports`; these reach " +
      "into another package's internals, which is a boundary that exists only by convention",
  )
})

test("SIMON-010-005 — no core package reads another module's tables", () => {
  assert.deepEqual(
    a.tableAccess.map((v) => `${v.file}:${v.line} — ${v.reason}`),
    [],
    "a shared package that opens a database connection or writes raw SQL has reached across a module " +
      "boundary into somebody else's tables",
  )
})

test("the tenant-config classifier separates a registry from a resolver", () => {
  // Non-vacuity for the two cases after it. If this classifier returned nothing,
  // both would pass against a tree full of violations.
  const specific = tenantSpecificExports()
  assert.ok(
    specific.includes("TENANT_BINDINGS"),
    `${TENANT_CONFIG_ENTRY}'s tenant registry is no longer classified as tenant-specific — this parser is broken`,
  )
  assert.ok(
    !specific.includes("getTenantBinding"),
    "a slug-parameterised resolver is not tenant-specific; classifying it so would forbid resolving anybody",
  )
  assert.ok(
    !specific.includes("BLUEPRINTS"),
    "the blueprint catalog names no tenant and must not be classified as tenant-specific",
  )
})

test("SIMON-010-008 — no core package imports a per-tenant configuration path", () => {
  const perTenant = a.tenantConfigImports.filter((v) => v.kind === "per-tenant-path")
  assert.deepEqual(
    perTenant.map((v) => `${v.file}:${v.line} — ${v.reason}`),
    [],
    "the bible's §5 boundary: a generic core package may not import one tenant's configuration",
  )
})

test("SIMON-010-008 — every core file named as importing the tenant registry still does", () => {
  // The list can only shrink. A file on it that no longer holds the import must
  // leave it, or the ledger's count of what is left stops being true.
  //
  // The other direction — failing on a core file NOT on the list — is
  // deliberately not asserted. Importing the whole registry and mapping it is
  // tenant-blind; it is what keeps SIMON-010-008 FAIL, not what makes the
  // runtime Simon-aware. The case below is the one that asserts the dangerous
  // shape.
  const holders = new Set(
    a.tenantConfigImports.filter((v) => v.kind === "tenant-registry").map((v) => v.file),
  )
  assert.ok(holders.size > 0, "no core file imports the tenant registry at all — then this list should be empty")
  const stale = Object.keys(KNOWN_TENANT_REGISTRY_IMPORTS).filter((f) => !holders.has(f))
  assert.deepEqual(
    stale,
    [],
    "these files are recorded as importing the tenant registry and no longer do — remove them from " +
      "KNOWN_TENANT_REGISTRY_IMPORTS and update the SIMON-010-008 row",
  )
})

test("SIMON-100-013 — no core file imports tenant configuration and names a tenant", () => {
  assert.deepEqual(
    a.simonAwareCoreFiles.map((v) => `${v.file}:${v.line} — names "${v.token}" — ${v.text}`),
    [],
    "this is Simon-aware core business logic: a shared package that can reach the tenant configuration " +
      "AND knows which tenant it wants",
  )
})

test("SIMON-100-013 — no core module is named for a tenant", () => {
  const tokens = tenantTokens()
  assert.ok(tokens.includes("rochester"), "the pilot's slug is not among the tenant tokens — the parser is broken")
  assert.ok(tokens.includes("simon"), "the pilot's own name is not among the tenant tokens — the parser is broken")
  // The tokens the first version of the derivation produced and should not:
  // generic product vocabulary that reached it through a FIXTURE's display name.
  for (const generic of ["corporate", "external", "erp", "shared", "arts", "office"])
    assert.ok(
      !tokens.includes(generic),
      `"${generic}" is product vocabulary, not a tenant's identity — a guard with false positives gets switched off`,
    )
  assert.deepEqual(
    a.tenantNamedCoreModules.map((v) => `${v.file} — ${v.reason}`),
    [],
    "a core module named for a tenant is a fork that has not admitted to being one",
  )
})
