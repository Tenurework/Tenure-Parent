#!/usr/bin/env node
/**
 * Module boundaries, dependency direction, and the tenant-configuration
 * boundary — computed from the tree, not declared in prose.
 *
 *   node tools/simon-module-boundaries.mjs           # write the document
 *   node tools/simon-module-boundaries.mjs --check   # fail if it is stale
 *
 * Three requirements of the Simon absorption bible are answered here, and they
 * are answered by ONE analyser because they are three questions about the same
 * graph — three separate scanners would disagree about what an import is long
 * before they disagreed about anything interesting.
 *
 *   SIMON-010-005  Define module boundaries and dependency direction; prohibit
 *                  circular imports and direct cross-module table access.
 *   SIMON-010-008  Add architecture checks preventing imports from
 *                  `tenant-config/tenants/simon-ose` into generic core packages.
 *   SIMON-100-013  CI rules that fail if core code imports Simon configuration,
 *                  if a Simon-only core module appears, or if tenant code forks
 *                  re-emerge.
 *
 * The bible's §5 draws a monorepo shape with `tenant-config/tenants/simon-ose/`
 * in it and then says, in the same section: "Do not force these literal paths
 * if the real monorepo has a better coherent convention." This repository's
 * convention is `blueprints/` — one workspace holding the blueprint catalog AND
 * the tenant bindings, where a binding is the per-tenant overlay that the
 * bible's `tenant-config/tenants/<slug>/` directory would hold. So the guard is
 * written against the concept rather than the path: whatever the entry point of
 * the tenant-configuration workspace exports that NAMES SPECIFIC TENANTS is
 * what a generic core package may not import.
 *
 * Which exports those are is computed (`tenantSpecificExports`), never listed.
 * A hand-written list of forbidden symbols is a guard that stops working the
 * day somebody adds the fifth one, and stops working silently.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO. It does not assert that the rendered
 * document equals the current tree. Every check here runs against the LIVE
 * working tree, which many people edit at once; a snapshot-equality assertion
 * over a live tree turns any unrelated import into a red suite. The guard
 * asserts PROPERTIES — acyclic, no deep imports, no database client, no
 * tenant-specific import, no tenant-named core module — each of which is a
 * thing somebody has to do wrong for it to fire. `--check` exists for the
 * person regenerating the document, not for CI.
 */
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

const OUT = "docs/architecture/simon-module-boundaries.md"

/** The workspace globs that hold shared code, from the root manifest rather than typed again. */
const WORKSPACE_GLOBS = ["packages/*/package.json", "modules/package.json", "blueprints/package.json"]

/**
 * Where the tenant configuration lives in THIS repository.
 *
 * One string, in one place, because it is the single judgement this file makes
 * about the bible's §5 shape and it should be arguable in one line rather than
 * spread through five regexes.
 */
export const TENANT_CONFIG_WORKSPACE = "@tenure/blueprints"
export const TENANT_CONFIG_ENTRY = "blueprints/index.ts"

/**
 * Core code: the packages that serve every tenant.
 *
 * `apps/` is NOT core. An application is the composition edge — the place a
 * request arrives carrying a tenant, and therefore the one layer that is
 * allowed to look a tenant up. Forbidding it there would forbid the platform
 * from resolving anybody's configuration.
 */
const CORE_ROOTS = ["packages", "modules"]

const IS_TEST = /\.(test|itest|spec)\.(tsx?|mjs|js)$/
const IS_SOURCE = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/

/**
 * Tracked files only.
 *
 * `--others --exclude-standard` would also catch a violation before it is
 * committed, which is tempting. It is not what this guard wants: the answer
 * would then depend on whatever is in somebody's working copy — a half-written
 * package, a scratch file, another person's branch mid-edit — and a boundary
 * report that changes depending on who ran it is not evidence. CI checks out
 * the commit, so a violation that is committed is a violation this sees.
 */
const gitFiles = (...args) =>
  execFileSync("git", ["ls-files", "--cached", ...args], {
    cwd: ROOT,
    encoding: "utf8",
  })
    .split("\n")
    .filter(Boolean)
    .map((f) => f.replace(/\\/g, "/"))

const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8").replace(/\r\n/g, "\n")

/**
 * Source with comments removed.
 *
 * Load-bearing rather than tidy: `packages/provisioning/src/manifest.ts`
 * mentions `@tenure/blueprints` twice, both times in a comment explaining why it
 * does NOT import it. A scanner that reads comments records that file as a
 * boundary violation and the boundary violation is the comment saying there
 * isn't one.
 */
export function stripComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((l) => l.replace(/(^|[^:"'`\\])\/\/.*$/, "$1"))
    .join("\n")
}

/** name → directory, for every workspace holding shared code. */
export function workspaces() {
  const out = {}
  for (const manifest of gitFiles(...WORKSPACE_GLOBS).sort()) {
    const json = JSON.parse(read(manifest))
    if (!json.name) continue
    out[json.name] = {
      dir: path.posix.dirname(manifest),
      manifest,
      dependencies: { ...(json.dependencies ?? {}), ...(json.peerDependencies ?? {}) },
      exports: json.exports ?? null,
    }
  }
  return out
}

/**
 * Every import specifier in one file, with its line and whether it is type-only.
 *
 * `import type {...}` and `export type {...}` are erased by the compiler, so a
 * cycle made only of those is not a cycle at runtime. Reporting them as one
 * would mean either a false alarm or a guard nobody trusts; they are collected
 * and kept apart instead.
 */
export function importsOf(text) {
  const src = stripComments(text)
  const lines = src.split("\n")
  const found = []
  const patterns = [
    { re: /^\s*import\s+type\s[\s\S]*?from\s*["']([^"']+)["']/, type: true },
    { re: /^\s*export\s+type\s[\s\S]*?from\s*["']([^"']+)["']/, type: true },
    { re: /^\s*import\s[\s\S]*?from\s*["']([^"']+)["']/, type: false },
    { re: /^\s*export\s[\s\S]*?from\s*["']([^"']+)["']/, type: false },
    { re: /^\s*import\s*["']([^"']+)["']/, type: false },
    { re: /import\(\s*["']([^"']+)["']\s*\)/, type: false },
    { re: /require\(\s*["']([^"']+)["']\s*\)/, type: false },
  ]
  // A multi-line `import {\n a,\n b\n} from "x"` has its specifier on a later
  // line than its keyword, so each statement is joined to the first line that
  // closes it before matching. Cheap, and it is how the real files are written.
  for (let i = 0; i < lines.length; i++) {
    let window = lines[i]
    if (/^\s*(import|export)\b/.test(lines[i]) && !/from\s*["']/.test(lines[i])) {
      for (let j = i + 1; j < Math.min(i + 25, lines.length); j++) {
        window += "\n" + lines[j]
        if (/from\s*["'][^"']+["']/.test(lines[j])) break
      }
    }
    for (const { re, type } of patterns) {
      const m = window.match(re)
      if (m) {
        found.push({ specifier: m[1], line: i + 1, typeOnly: type })
        break
      }
    }
  }
  return found
}

/** Which workspace a repository-relative path belongs to, or null. */
export function workspaceOf(file, ws) {
  for (const [name, meta] of Object.entries(ws)) if (file.startsWith(meta.dir + "/")) return name
  return null
}

/**
 * The cross-workspace import graph of the shared code, in four parts:
 * production value edges, production type-only edges, test edges, and every
 * edge's evidence.
 */
export function importGraph(ws = workspaces()) {
  const files = CORE_ROOTS.concat(Object.values(ws).map((w) => w.dir))
    .filter((r, i, a) => a.indexOf(r) === i)
    .flatMap((r) => gitFiles(r))
    .filter((f) => IS_SOURCE.test(f))
    .filter((f, i, a) => a.indexOf(f) === i)
    .sort()

  const prod = {}
  const typeOnly = {}
  const tests = {}
  const evidence = []
  const deepImports = []

  for (const file of files) {
    const from = workspaceOf(file, ws)
    if (!from) continue
    const isTest = IS_TEST.test(file)
    for (const imp of importsOf(read(file))) {
      const target = Object.keys(ws).find((n) => imp.specifier === n || imp.specifier.startsWith(n + "/"))
      if (!target || target === from) continue
      if (imp.specifier !== target) {
        // A subpath. Legal only if the target workspace declares it in `exports`.
        const subpath = "." + imp.specifier.slice(target.length)
        const declared = ws[target].exports && Object.keys(ws[target].exports).includes(subpath)
        if (!declared && !isTest) deepImports.push({ file, line: imp.line, specifier: imp.specifier })
      }
      const bucket = isTest ? tests : imp.typeOnly ? typeOnly : prod
      ;(bucket[from] = bucket[from] ?? new Set()).add(target)
      evidence.push({ from, to: target, file, line: imp.line, typeOnly: imp.typeOnly, test: isTest })
    }
  }
  return { files, prod, typeOnly, tests, evidence, deepImports }
}

/** Every elementary cycle reachable by DFS, each rendered as a path string. */
export function cyclesOf(graph, nodes) {
  const seen = new Set()
  const out = []
  const colour = {}
  const stack = []
  const visit = (n) => {
    colour[n] = 1
    stack.push(n)
    for (const m of [...(graph[n] ?? [])].sort()) {
      if (colour[m] === 1) {
        const cycle = stack.slice(stack.indexOf(m)).concat(m)
        const key = cycle.join(" -> ")
        if (!seen.has(key)) {
          seen.add(key)
          out.push(key)
        }
      } else if (!colour[m]) visit(m)
    }
    stack.pop()
    colour[n] = 2
  }
  for (const n of [...nodes].sort()) if (!colour[n]) visit(n)
  return out.sort()
}

/**
 * Tier = longest path to a workspace with no shared-code dependency.
 *
 * Derived, so nobody has to keep a layering diagram in step with the code. A
 * tier is only meaningful on a DAG; on a graph with a cycle the members of the
 * cycle are reported as `UNTIERED`, which is the honest answer rather than an
 * arbitrary one.
 */
export function tiers(prod, nodes) {
  const depth = {}
  const inProgress = new Set()
  const of = (n) => {
    if (depth[n] !== undefined) return depth[n]
    if (inProgress.has(n)) return null
    inProgress.add(n)
    let d = 0
    for (const m of prod[n] ?? []) {
      const sub = of(m)
      if (sub === null) {
        inProgress.delete(n)
        return null
      }
      d = Math.max(d, sub + 1)
    }
    inProgress.delete(n)
    depth[n] = d
    return d
  }
  const out = {}
  for (const n of [...nodes].sort()) out[n] = of(n)
  return out
}

/**
 * Which exports of the tenant-configuration entry point name specific tenants.
 *
 * Computed from the entry point's own source: an exported `const` whose
 * initializer either carries a `slug:` literal or is derived from one that
 * does. A slug-parameterised function (`getTenantBinding(slug: string)`) is
 * NOT tenant-specific — it is the generic resolver, and the whole point of the
 * architecture is that core code receives a tenant through one of those rather
 * than reaching for a name.
 */
export function tenantSpecificExports(entry = TENANT_CONFIG_ENTRY) {
  const src = stripComments(read(entry))
  const blocks = []
  const decl = /^export\s+const\s+([A-Za-z0-9_$]+)\b/gm
  let m
  const marks = []
  while ((m = decl.exec(src))) marks.push({ name: m[1], at: m.index })
  for (let i = 0; i < marks.length; i++) {
    const end = i + 1 < marks.length ? marks[i + 1].at : src.length
    blocks.push({ name: marks[i].name, body: src.slice(marks[i].at, end) })
  }
  const tenantSpecific = []
  // Two passes: the direct carriers first, then the ones derived from them, so
  // `CUSTOMER_TENANT_BINDINGS = TENANT_BINDINGS.filter(...)` is caught by the
  // reference rather than needing its own slug literal.
  for (const b of blocks) if (/\bslug\s*:\s*["'][^"']+["']/.test(b.body)) tenantSpecific.push(b.name)
  let grew = true
  while (grew) {
    grew = false
    for (const b of blocks) {
      if (tenantSpecific.includes(b.name)) continue
      if (tenantSpecific.some((t) => new RegExp(`\\b${t}\\b`).test(b.body))) {
        tenantSpecific.push(b.name)
        grew = true
      }
    }
  }
  return tenantSpecific.sort()
}

/**
 * Every tenant binding, with its slug, whether it is a fixture, its display
 * name and its configured terminology values.
 *
 * Parsed rather than imported because this analyser and its guard run under
 * `node --test` with no TypeScript transform, which is also why the existing
 * `tests/architecture/no-tenant-fork-or-branch.test.mjs` parses the same file.
 */
export function tenantBindings(entry = TENANT_CONFIG_ENTRY) {
  const src = stripComments(read(entry))
  const start = src.indexOf("export const TENANT_BINDINGS")
  if (start < 0) throw new Error(`${entry} no longer declares TENANT_BINDINGS — this parser is broken`)
  const marks = [...src.matchAll(/^\s*slug\s*:\s*["']([^"']+)["']/gm)].filter((m) => m.index > start)
  const out = []
  for (let i = 0; i < marks.length; i++) {
    const from = marks[i].index
    const to = i + 1 < marks.length ? marks[i + 1].index : src.length
    const body = src.slice(from, to)
    out.push({
      slug: marks[i][1],
      fixture: /\bfixture\s*:\s*true\b/.test(body),
      displayName: body.match(/\bdisplayName\s*:\s*["']([^"']+)["']/)?.[1] ?? "",
      terminology: [...body.matchAll(/"platform\.terminology\.[A-Za-z.]+"\s*:\s*["']([^"']+)["']/g)].map((m) => m[1]),
    })
  }
  return out
}

/** Every tenant slug the bindings declare. */
export function tenantSlugs(entry = TENANT_CONFIG_ENTRY) {
  return [...new Set(tenantBindings(entry).map((b) => b.slug))].sort()
}

/**
 * Generic organisational nouns, which are not a tenant's identity.
 *
 * "Business", "School" and "Office" appear in the pilot's display name and in
 * the product's own vocabulary; a path guard that treated them as tenant tokens
 * would fire on `packages/organization-model` and be switched off within a day.
 */
const GENERIC_ORG_WORDS = new Set([
  "the", "and", "for", "of", "office", "school", "business", "college", "university",
  "student", "students", "engagement", "program", "programme", "programs", "collective",
  "arts", "center", "centre", "department", "division", "group", "institute", "services",
  "organization", "organisation", "conventions", "fixture", "right", "left",
])

/**
 * The words that name a tenant rather than describe one.
 *
 * Two rules, and both of them exist because the first version of this function
 * produced six false positives and a guard with false positives is a guard
 * somebody switches off.
 *
 *   1. A slug is a token WHOLE. Splitting `fixture-external-erp` on its hyphens
 *      yields `external` and `erp`, which then match
 *      `packages/payments/src/external-reference.ts` — a generic module about
 *      external payment references, named for nobody.
 *   2. Only a CUSTOMER's display name and terminology contribute words. A
 *      fixture is deliberately named out of the product's own vocabulary
 *      ("Northwind Industrial", "corporate", "shared services"), so treating
 *      its words as tenant identity flags exactly the generic modules the
 *      fixture exists to prove are generic.
 *
 * What survives for this repository is `rochester`, `simon`, `ainslie`, `ose` —
 * the pilot's slug and the three proper nouns that name it, which is precisely
 * what SIMON-100-013's "a Simon-only core module" means.
 */
export function tenantTokens(entry = TENANT_CONFIG_ENTRY) {
  const bindings = tenantBindings(entry)
  const words = new Set(bindings.map((b) => b.slug.toLowerCase()))
  for (const b of bindings) {
    if (b.fixture) continue
    for (const value of [b.displayName, ...b.terminology]) {
      for (const raw of value.split(/[^A-Za-z0-9]+/)) {
        const w = raw.toLowerCase()
        if (w.length >= 3 && !GENERIC_ORG_WORDS.has(w)) words.add(w)
      }
    }
  }
  return [...words].sort()
}

/** Database clients and raw-SQL escapes. A core package reaching for one of these is reaching into somebody's tables. */
const DATABASE_CLIENTS = [
  /^@prisma\/client$/,
  /^\.prisma\//,
  /^pg$/,
  /^pg-promise$/,
  /^mysql2?$/,
  /^sqlite3?$/,
  /^better-sqlite3$/,
  /^knex$/,
  /^drizzle-orm/,
  /^typeorm$/,
  /^sequelize$/,
  /^mongodb$/,
  /(^|\/)db$/,
]
const RAW_SQL = /\$(queryRaw|executeRaw|queryRawUnsafe|executeRawUnsafe)\b/

/** SIMON-010-005's second clause: no core module reads another module's tables. */
export function tableAccess(ws = workspaces()) {
  const out = []
  for (const file of CORE_ROOTS.flatMap((r) => gitFiles(r))
    .filter((f) => IS_SOURCE.test(f) && !IS_TEST.test(f))
    .sort()) {
    const text = stripComments(read(file))
    for (const imp of importsOf(text)) {
      if (DATABASE_CLIENTS.some((re) => re.test(imp.specifier)))
        out.push({ file, line: imp.line, reason: `imports the database client \`${imp.specifier}\`` })
    }
    const lines = text.split("\n")
    for (let i = 0; i < lines.length; i++)
      if (RAW_SQL.test(lines[i])) out.push({ file, line: i + 1, reason: "executes raw SQL" })
  }
  return out
}

/**
 * The core files that import the tenant registry today, and what each should
 * take as an argument instead.
 *
 * Named rather than counted, and shrink-only: the guard fails if one of these
 * no longer holds the import, so the list cannot go stale, and it fails if a
 * file not on it acquires one, so the boundary cannot get worse while
 * SIMON-010-008 is open.
 *
 * Neither of these is a Simon branch. Both are `TENANT_BINDINGS.map(...)` fleet
 * views that treat every tenant identically — which is why they are recorded
 * here rather than in the prohibited set, and why SIMON-010-008 is FAIL rather
 * than the requirement being quietly redefined around them. The pilot's overlay
 * values are nonetheless inside a generic core package's module graph, which is
 * the boundary the bible asks for and this repository does not yet have.
 */
export const KNOWN_TENANT_REGISTRY_IMPORTS = {
  "packages/platform-config/src/modules.ts":
    "`modulesForEveryTenant` maps the registry; the fleet view belongs to the composition edge, and this function should take the bindings as an argument",
  "packages/platform-config/src/resolve.ts":
    "`systemConfigForEveryTenant` maps the registry; same shape, same fix",
}

/** SIMON-010-008: a core file importing a tenant-specific configuration export, or a per-tenant path. */
export function tenantConfigImports(ws = workspaces()) {
  const forbidden = tenantSpecificExports()
  const out = []
  for (const file of CORE_ROOTS.flatMap((r) => gitFiles(r))
    .filter((f) => IS_SOURCE.test(f) && !IS_TEST.test(f))
    .sort()) {
    const text = stripComments(read(file))
    const lines = text.split("\n")
    for (const imp of importsOf(text)) {
      const isTenantConfig =
        imp.specifier === TENANT_CONFIG_WORKSPACE || imp.specifier.startsWith(TENANT_CONFIG_WORKSPACE + "/")
      const isPerTenantPath = /(^|\/)(tenant-config|tenants)\//.test(imp.specifier)
      if (!isTenantConfig && !isPerTenantPath) continue
      // The clause of the import statement, which is where the symbol names are.
      let clause = lines[imp.line - 1] ?? ""
      for (let j = imp.line; j < Math.min(imp.line + 24, lines.length); j++) {
        if (/from\s*["'][^"']+["']/.test(clause)) break
        clause += "\n" + lines[j]
      }
      const named = forbidden.filter((sym) => new RegExp(`[{,\\s]${sym}\\s*[,}\\s]`).test(clause))
      if (isPerTenantPath)
        out.push({
          kind: "per-tenant-path",
          file,
          line: imp.line,
          reason: `imports a per-tenant path \`${imp.specifier}\``,
        })
      for (const sym of named)
        out.push({
          kind: "tenant-registry",
          file,
          line: imp.line,
          reason: `imports the tenant-specific export \`${sym}\``,
        })
    }
  }
  return out
}

/**
 * SIMON-100-013's first clause, in the shape that is actually dangerous: a core
 * file that imports tenant configuration AND names a tenant.
 *
 * The conjunction is the point. A core package that maps the whole registry is
 * tenant-blind and is reported above; a core package that imports tenant
 * configuration and then writes `rochester`, `Simon` or `Ainslie` is the
 * Simon-aware core the bible's §2 prohibits, and it is a different claim.
 *
 * Naming a tenant ANYWHERE in shipped source is separately prohibited by
 * `tests/architecture/no-tenant-fork-or-branch.test.mjs`, which asserts the
 * slugs. This one asserts the tenant's proper nouns as well — `Simon`,
 * `Ainslie`, `OSE` are not slugs and that test does not see them — and it
 * asserts them where they do the most damage, which is beside the import that
 * makes the configuration reachable.
 */
export function simonAwareCoreFiles(ws = workspaces()) {
  const tokens = tenantTokens()
  const out = []
  for (const file of CORE_ROOTS.flatMap((r) => gitFiles(r))
    .filter((f) => IS_SOURCE.test(f) && !IS_TEST.test(f))
    .sort()) {
    const text = stripComments(read(file))
    const importsTenantConfig = importsOf(text).some(
      (i) =>
        i.specifier === TENANT_CONFIG_WORKSPACE ||
        i.specifier.startsWith(TENANT_CONFIG_WORKSPACE + "/") ||
        /(^|\/)(tenant-config|tenants)\//.test(i.specifier),
    )
    if (!importsTenantConfig) continue
    for (const token of tokens) {
      const re = new RegExp(`["'\`][^"'\`]*\\b${token}\\b[^"'\`]*["'\`]`, "i")
      const lines = text.split("\n")
      for (let i = 0; i < lines.length; i++)
        if (re.test(lines[i])) out.push({ file, line: i + 1, token, text: lines[i].trim().slice(0, 120) })
    }
  }
  return out
}

/** SIMON-100-013's second clause: a core module that exists for one tenant announces itself in its path. */
export function tenantNamedCoreModules() {
  const tokens = tenantTokens()
  const out = []
  const paths = CORE_ROOTS.flatMap((r) => gitFiles(r)).sort()
  for (const file of paths) {
    for (const token of tokens) {
      if (new RegExp(`(^|[/_.-])${token}([/_.-]|$)`, "i").test(file))
        out.push({ file, reason: `path names the tenant token \`${token}\`` })
    }
  }
  return out
}

/** Cross-workspace production imports the importing manifest does not declare. */
export function undeclaredDependencies(graph, ws = workspaces()) {
  const out = []
  for (const [from, targets] of Object.entries({ ...graph.prod })) {
    for (const to of [...targets].sort()) {
      if (!ws[from].dependencies[to]) out.push({ from, to, manifest: ws[from].manifest })
    }
  }
  return out.sort((a, b) => `${a.from}${a.to}`.localeCompare(`${b.from}${b.to}`))
}

/**
 * The invariants this analyser enforces, named.
 *
 * The guard test walks this list and asserts one case per entry, so an
 * invariant added here without a case — or a case whose invariant was quietly
 * dropped — is itself a failure.
 */
export const INVARIANTS = [
  "acyclic-production-imports",
  "no-deep-cross-workspace-imports",
  "no-direct-table-access",
  "no-per-tenant-path-import-from-core",
  "tenant-registry-imports-only-shrink",
  "no-simon-aware-core-file",
  "no-tenant-named-core-module",
]

export function analyse() {
  const ws = workspaces()
  const graph = importGraph(ws)
  const nodes = Object.keys(ws)
  const prodCycles = cyclesOf(graph.prod, nodes)
  const merged = {}
  for (const n of nodes)
    merged[n] = new Set([...(graph.prod[n] ?? []), ...(graph.typeOnly[n] ?? []), ...(graph.tests[n] ?? [])])
  return {
    workspaces: ws,
    graph,
    nodes,
    prodCycles,
    allCycles: cyclesOf(merged, nodes),
    tiers: tiers(graph.prod, nodes),
    deepImports: graph.deepImports,
    tableAccess: tableAccess(ws),
    tenantConfigImports: tenantConfigImports(ws),
    simonAwareCoreFiles: simonAwareCoreFiles(ws),
    tenantNamedCoreModules: tenantNamedCoreModules(),
    tenantSpecificExports: tenantSpecificExports(),
    tenantTokens: tenantTokens(),
    undeclared: undeclaredDependencies(graph, ws),
  }
}

function render(a) {
  const L = []
  L.push("# Module boundaries and dependency direction")
  L.push("")
  L.push("Generated by `tools/simon-module-boundaries.mjs`. Do not edit by hand.")
  L.push("")
  L.push(
    "Answers SIMON-010-005 (boundaries, direction, no circular imports, no direct cross-module table access), " +
      "SIMON-010-008 (no tenant configuration inside generic core packages) and SIMON-100-013 " +
      "(the CI rules that keep both true).",
  )
  L.push("")
  L.push("## Invariants asserted in CI")
  L.push("")
  L.push("`tests/architecture/simon-module-boundaries.test.mjs`, reached by `npm run test:platform`.")
  L.push("")
  for (const i of INVARIANTS) L.push(`- \`${i}\``)
  L.push("")
  L.push("## Tiers")
  L.push("")
  L.push(
    "Tier is the longest production import path from a workspace to one with no shared-code dependency. " +
      "It is derived from the graph, not declared: a workspace inside a cycle has no tier, and is reported as `UNTIERED`.",
  )
  L.push("")
  L.push("| Tier | Workspace | Depends on (production) |")
  L.push("| ---: | --- | --- |")
  for (const n of a.nodes.slice().sort((x, y) => (a.tiers[x] ?? 99) - (a.tiers[y] ?? 99) || x.localeCompare(y))) {
    const deps = [...(a.graph.prod[n] ?? [])].sort()
    L.push(`| ${a.tiers[n] === null ? "UNTIERED" : a.tiers[n]} | \`${n}\` | ${deps.map((d) => `\`${d}\``).join(", ") || "—"} |`)
  }
  L.push("")
  L.push("## Circular imports")
  L.push("")
  L.push(`Production value imports: **${a.prodCycles.length}**.`)
  for (const c of a.prodCycles) L.push(`- \`${c}\``)
  L.push("")
  L.push(
    `Including type-only and test imports: **${a.allCycles.length}**. Type-only imports are erased by the compiler ` +
      "and test imports do not ship, so these are reported and not prohibited.",
  )
  for (const c of a.allCycles) L.push(`- \`${c}\``)
  L.push("")
  L.push("## Direct cross-module table access")
  L.push("")
  L.push(
    `Core production files importing a database client or executing raw SQL: **${a.tableAccess.length}**. ` +
      "Core is `packages/` and `modules/`; an application is the composition edge and is not core.",
  )
  for (const v of a.tableAccess) L.push(`- \`${v.file}:${v.line}\` — ${v.reason}`)
  L.push("")
  L.push("## Tenant configuration boundary")
  L.push("")
  L.push(
    "The bible's §5 names `tenant-config/tenants/simon-ose/` and then permits a better coherent convention. " +
      `This repository's is \`${TENANT_CONFIG_ENTRY}\` — the tenant bindings, one per tenant, each the overlay ` +
      "that a per-tenant directory would hold.",
  )
  L.push("")
  L.push("Exports of that entry point that name specific tenants, computed from its own source:")
  L.push("")
  for (const e of a.tenantSpecificExports) L.push(`- \`${e}\``)
  L.push("")
  const perTenant = a.tenantConfigImports.filter((v) => v.kind === "per-tenant-path")
  const registry = a.tenantConfigImports.filter((v) => v.kind === "tenant-registry")
  L.push(`Core production files importing a per-tenant path: **${perTenant.length}** — prohibited.`)
  for (const v of perTenant) L.push(`- \`${v.file}:${v.line}\` — ${v.reason}`)
  L.push("")
  L.push(
    `Core production files importing the tenant registry: **${registry.length}** — known, named, and shrink-only. ` +
      "SIMON-010-008 stays FAIL while any remain.",
  )
  for (const v of registry)
    L.push(`- \`${v.file}:${v.line}\` — ${v.reason}. ${KNOWN_TENANT_REGISTRY_IMPORTS[v.file] ?? "**not on the known list**"}`)
  L.push("")
  L.push(
    "A slug-parameterised resolver is on neither list and is not prohibited. `getTenantBinding(slug)` is how a " +
      "tenant arrives as an argument; forbidding it would forbid the platform from resolving anybody.",
  )
  L.push("")
  L.push(
    `Core production files that import tenant configuration AND name a tenant: **${a.simonAwareCoreFiles.length}** — prohibited. ` +
      "This is the conjunction the bible's §2 calls Simon-aware core business logic.",
  )
  for (const v of a.simonAwareCoreFiles) L.push(`- \`${v.file}:${v.line}\` — names \`${v.token}\``)
  L.push("")
  L.push("## Tenant-named core modules")
  L.push("")
  L.push(`Tokens that name a tenant, derived from the bindings: ${a.tenantTokens.map((t) => `\`${t}\``).join(", ")}.`)
  L.push("")
  L.push(`Core paths carrying one: **${a.tenantNamedCoreModules.length}**.`)
  for (const v of a.tenantNamedCoreModules) L.push(`- \`${v.file}\` — ${v.reason}`)
  L.push("")
  L.push("## Deep cross-workspace imports")
  L.push("")
  L.push(
    `Production imports reaching past a workspace's declared entry point: **${a.deepImports.length}**. ` +
      "A subpath is legal only where the target manifest declares it in `exports`.",
  )
  for (const v of a.deepImports) L.push(`- \`${v.file}:${v.line}\` — \`${v.specifier}\``)
  L.push("")
  L.push("## Undeclared workspace dependencies")
  L.push("")
  L.push(
    `Production cross-workspace imports the importing manifest does not declare: **${a.undeclared.length}**. ` +
      "Reported, not prohibited: they resolve through npm's flat `node_modules` and fixing them is a manifest " +
      "change that has to go through an install, which this analyser will not do for you.",
  )
  L.push("")
  if (a.undeclared.length) {
    L.push("| Importer | Imports | Manifest |")
    L.push("| --- | --- | --- |")
    for (const u of a.undeclared) L.push(`| \`${u.from}\` | \`${u.to}\` | \`${u.manifest}\` |`)
    L.push("")
  }
  return L.join("\n") + "\n"
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const a = analyse()
  const doc = render(a)
  const target = path.join(ROOT, OUT)
  if (process.argv.includes("--check")) {
    const current = fs.existsSync(target) ? fs.readFileSync(target, "utf8").replace(/\r\n/g, "\n") : ""
    if (current !== doc) {
      console.error(`stale — ${OUT} is not what the tree now says. Re-run without --check.`)
      process.exit(1)
    }
    console.log(`ok — ${OUT} matches the tree`)
  } else {
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, doc)
    console.log(`wrote ${OUT}`)
  }
  console.log(
    `workspaces ${a.nodes.length}; production cycles ${a.prodCycles.length}; deep imports ${a.deepImports.length}; ` +
      `table access ${a.tableAccess.length}; tenant-config imports ${a.tenantConfigImports.length}; ` +
      `tenant-named core modules ${a.tenantNamedCoreModules.length}; undeclared deps ${a.undeclared.length}`,
  )
}
