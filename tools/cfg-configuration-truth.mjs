#!/usr/bin/env node
/**
 * CFG-000-001 — inspect the repository, the System Studio routes, the
 * authentication, the configuration code, the databases, the IaC, the
 * workflows, the tests and the deployed nonproduction behaviour, and write down
 * what is actually there.
 *
 * Generated from `git ls-files`, never written by hand, for the reason
 * `tools/repository-map.mjs` gives: a hand-written inventory is true on the day
 * it is typed and wrong from the next commit, and an inventory nobody can
 * re-derive is indistinguishable from a paragraph somebody remembered. Every
 * row below names a path that the checker opens; a row naming a file that does
 * not exist fails the guard rather than sitting there looking authoritative.
 *
 * ## The ninth axis, and why it is a row rather than a silence
 *
 * The requirement's last words are "deployed nonproduction behavior". This
 * process has no AWS credentials and is forbidden from acquiring any, so it
 * cannot describe the behaviour of a running environment. What it CAN do — and
 * what the axis actually turns out to need — is establish whether a deployed
 * nonproduction environment exists to have behaviour at all. That is a question
 * the tree answers three independent ways:
 *
 *   * `infrastructure/oidc/environments.json` declares every GitHub environment
 *     the deployment roles trust. Two: `aws-read` and `engine-production`.
 *   * no workflow under `.github/workflows` names a staging, nonproduction,
 *     preview or sandbox deployment target.
 *   * `docs/architecture/aws-current-state.md` — produced by a real read-only
 *     inventory run from `.github/workflows/aws-inventory.yml`, not by this
 *     script — records a single-account estate with Organizations not in use.
 *
 * So the honest finding is "there is no deployed nonproduction environment in
 * this estate", and `tests/architecture/cfg-configuration-truth-is-current.test.mjs`
 * holds all three derivations, so the row reds the moment one appears. That is
 * a different and weaker claim than "we inspected nonproduction and it behaves
 * thus", and the document says which one it is making.
 *
 * ## Byte-identical on Linux and Windows
 *
 * Paths come from `git ls-files`, which emits POSIX separators, and are sorted
 * with `<` on those POSIX strings — never `path.sep`, never `readdirSync` order.
 * Every file read is normalised CRLF -> LF before a single regex touches it, so
 * a checkout with `core.autocrlf=true` counts the same models, the same
 * resources and the same exports as a Linux runner. Nothing here embeds a
 * timestamp, a hostname or an absolute path.
 *
 * Usage:
 *   node tools/cfg-configuration-truth.mjs            write the document
 *   node tools/cfg-configuration-truth.mjs --check    fail if it is stale
 */
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const HERE = path.dirname(fileURLToPath(import.meta.url))
export const ROOT = path.resolve(HERE, "..")
export const OUT = "docs/architecture/cfg-configuration-truth.md"

/**
 * Every file in the tree that is not ignored — tracked AND untracked.
 *
 * `git ls-files` alone sees only what is committed, so a brand-new route or a
 * brand-new form module is invisible to this inventory until after it has been
 * pushed, which is exactly when an inventory stops being useful. The root
 * `package.json` records this repository learning that the expensive way: a
 * generated artefact was "fixed by counting untracked files" after it shipped
 * current-at-write and stale-at-push.
 *
 * `--exclude-standard` keeps `.gitignore` honoured, so `node_modules` and build
 * output stay out. Output is POSIX-separated (git's own form) and sorted by
 * codepoint — never `localeCompare`, never `readdirSync` order, both of which
 * differ across platforms and would make this file current here and stale in CI.
 */
export function trackedFiles() {
  const git = (...args) => execFileSync("git", args, { cwd: ROOT, encoding: "utf8" })
  const all = [...git("ls-files").split("\n"), ...git("ls-files", "--others", "--exclude-standard").split("\n")]
  return [...new Set(all.map((f) => f.trim()).filter(Boolean))].sort()
}

/**
 * Read a tracked file with line endings normalised.
 *
 * Every count this script derives comes through here. Counting `^model` on raw
 * bytes is the checkout-dependent-artefact failure in miniature: `\r\n` does
 * not change a `^model` count, but it does change `export const x = 1\r` into a
 * name with a carriage return in it, and the document then differs between a
 * Windows checkout and CI.
 */
export function read(rel) {
  try {
    return fs.readFileSync(path.join(ROOT, rel), "utf8").replace(/\r\n/g, "\n")
  } catch {
    return ""
  }
}

const exists = (rel) => fs.existsSync(path.join(ROOT, rel))

/** Names exported from a TS/JS module. Deterministic, and good enough to say what a module is for. */
function exportedNames(source) {
  const names = new Set()
  for (const m of source.matchAll(/^export\s+(?:async\s+)?(?:function|const|class|interface|type|enum)\s+([A-Za-z0-9_$]+)/gm)) {
    names.add(m[1])
  }
  return [...names].sort()
}

/* ───────────────────────────────────────────────────────────── axis A: routes */

const STUDIO_APP = "apps/system-studio/src/app/"
const ROUTE_KINDS = {
  "page.tsx": "page",
  "route.ts": "api",
  "actions.ts": "server-actions",
  "layout.tsx": "layout",
}

/**
 * The authorization vocabulary a Studio handler can be written in.
 *
 * Reported as what the file MENTIONS, which is a strong signal and a weak
 * proof — the same caveat `tools/entry-point-inventory.mjs` states. The proof
 * that the configurator surfaces reach exactly one of these lives in
 * `tests/security/cfg-one-authorization-path.test.mjs`; this column is what
 * makes the question askable in the first place.
 */
const AUTHZ_MARKERS = [
  ["authorizeCommand", /\bauthorizeCommand\s*\(/],
  ["authorizeOperator", /\bauthorizeOperator\s*\(/],
  ["isOperator", /\bisOperator\s*\(/],
  ["session", /\bauth\s*\(\s*\)/],
]

function studioRoutes(files) {
  const rows = []
  for (const file of files) {
    if (!file.startsWith(STUDIO_APP)) continue
    const base = file.slice(file.lastIndexOf("/") + 1)
    const kind = ROUTE_KINDS[base]
    if (!kind) continue
    const source = read(file)
    const guards = AUTHZ_MARKERS.filter(([, re]) => re.test(source)).map(([name]) => name)
    const dir = file.slice(STUDIO_APP.length, file.length - base.length - 1)
    const route = "/" + dir
    rows.push({
      axis: "studio-route",
      path: file,
      kind,
      fact: `${route === "/" ? "/" : route} · authz: ${guards.length ? guards.join(", ") : "none named"}`,
    })
  }
  return rows
}

/* ─────────────────────────────────────────────────────── axis B: authentication */

/**
 * Authentication and authorization modules, derived by filename rather than
 * listed. A list is a thing that stops being complete; the pattern below fails
 * loudly instead, because a new `…/rbac.ts` appears in the document and the
 * checker reds until the committed copy is regenerated.
 */
const AUTH_FILE = /(^|\/)(auth|auth-config|authorize|operators|rbac|guard|capabilities|tenant-scope)\.ts$/

function authentication(files) {
  const rows = []
  for (const file of files) {
    if (!/^apps\/[^/]+\/src\//.test(file)) continue
    if (!AUTH_FILE.test(file)) continue
    const source = read(file)
    rows.push({
      axis: "authentication",
      path: file,
      kind: file.startsWith("apps/system-studio/") ? "studio" : "tenant-app",
      fact: `exports: ${exportedNames(source).join(", ") || "(none)"}`,
    })
  }
  for (const file of files) {
    if (!/\[\.\.\.nextauth\]\/route\.ts$/.test(file)) continue
    rows.push({
      axis: "authentication",
      path: file,
      kind: file.startsWith("apps/system-studio/") ? "studio" : "tenant-app",
      fact: "NextAuth request handler",
    })
  }
  return rows
}

/* ──────────────────────────────────────────────────── axis C: configuration code */

/** Where configuration and form code lives. Directory prefixes, so a new file inside one is picked up. */
export const CONFIGURATION_ROOTS = [
  "packages/configuration/src/",
  "packages/platform-config/src/",
  "apps/web/src/lib/config/",
  "apps/web/src/lib/forms/",
  "apps/web/src/app/(app)/settings/",
  "apps/system-studio/src/app/tenants/[slug]/configuration/",
  "apps/system-studio/src/app/tenants/new/",
]

/** Individual configuration modules that do not sit under a configuration directory. */
export const CONFIGURATION_FILE = /(^|\/)(config-store|config-sort-key|editable-config)\.ts$/

/** Form components, wherever they live. The suffix is the repository's own convention. */
export const FORM_FILE = /(^|\/)[A-Z][A-Za-z0-9]*(Form|Editor|Picker|Panel|Controls)\.tsx$/

const TEST_FILE = /\.(test|itest|spec)\.[cm]?[jt]sx?$/

/**
 * Every non-test form or configuration module in the tree.
 *
 * Exported because `tests/architecture/cfg-form-disposition-covers-the-tree.test.mjs`
 * (CFG-000-003) derives its left-hand side from exactly this function. Two
 * implementations of "what counts as configuration code" would disagree within
 * a month, and the disposition table would then be complete against a set
 * nobody else computes.
 */
export function configurationModules(files = trackedFiles()) {
  return files
    .filter((f) => !TEST_FILE.test(f))
    .filter((f) => /\.(ts|tsx|mjs)$/.test(f))
    .filter(
      (f) =>
        CONFIGURATION_ROOTS.some((root) => f.startsWith(root)) ||
        CONFIGURATION_FILE.test(f) ||
        (FORM_FILE.test(f) && /^apps\/(web|system-studio)\/src\//.test(f)),
    )
    .sort()
}

function configurationCode(files) {
  return configurationModules(files).map((file) => {
    const source = read(file)
    const names = exportedNames(source)
    const lines = source.split("\n").length
    return {
      axis: "configuration-code",
      path: file,
      kind: FORM_FILE.test(file) ? "form-component" : "configuration-module",
      fact: `${lines} lines · ${names.length} exports`,
    }
  })
}

/* ─────────────────────────────────────────────────────────── axis D: databases */

function databases(files) {
  const rows = []

  const schema = "apps/web/prisma/schema.prisma"
  if (exists(schema)) {
    const models = [...read(schema).matchAll(/^model\s+(\w+)\s*\{/gm)].map((m) => m[1]).sort()
    rows.push({
      axis: "database",
      path: schema,
      kind: "postgres-schema",
      fact: `${models.length} models · the tenant database, reached only through apps/web`,
    })
  }

  const migrations = files
    .filter((f) => /^apps\/web\/prisma\/migrations\/.+\/migration\.sql$/.test(f))
    .sort()
  if (migrations.length) {
    rows.push({
      axis: "database",
      path: "apps/web/prisma/migrations",
      kind: "postgres-migrations",
      fact: `${migrations.length} applied migrations, earliest ${migrations[0].split("/")[4]}`,
    })
  }

  const ddb = "infrastructure/studio/dynamodb.tf"
  if (exists(ddb)) {
    const tables = [...read(ddb).matchAll(/^resource\s+"aws_dynamodb_table"\s+"([^"]+)"/gm)]
      .map((m) => m[1])
      .sort()
    rows.push({
      axis: "database",
      path: ddb,
      kind: "dynamodb",
      fact: `${tables.length} tables: ${tables.join(", ") || "(none)"} · the Studio's only store`,
    })
  }

  const store = "apps/system-studio/src/lib/config-store.ts"
  if (exists(store)) {
    rows.push({
      axis: "database",
      path: store,
      kind: "dynamodb-client",
      fact: "the configuration store the Studio writes revisions through",
    })
  }
  return rows
}

/* ──────────────────────────────────────────────────────────────── axis E: IaC */

function iac(files) {
  const rows = []
  for (const file of files.filter((f) => f.startsWith("infrastructure/") && f.endsWith(".tf"))) {
    const source = read(file)
    const resources = [...source.matchAll(/^resource\s+"([a-z0-9_]+)"/gm)].length
    const data = [...source.matchAll(/^data\s+"([a-z0-9_]+)"/gm)].length
    rows.push({
      axis: "iac",
      path: file,
      kind: `terraform:${file.split("/")[1]}`,
      fact: `${resources} resources · ${data} data sources`,
    })
  }
  const envs = "infrastructure/oidc/environments.json"
  if (exists(envs)) {
    const names = (JSON.parse(read(envs)).environments ?? []).map((e) => e.name).sort()
    rows.push({
      axis: "iac",
      path: envs,
      kind: "github-environments",
      fact: `declared environments: ${names.join(", ") || "(none)"}`,
    })
  }
  return rows
}

/* ────────────────────────────────────────────────────────── axis F: workflows */

/**
 * The production disarm this repository must never lose. Matched as a literal,
 * because the thing being reported is whether that exact line is present.
 */
const DISARM = "github.repository == 'Tenurework/Tenure'"

function workflows(files) {
  return files
    .filter((f) => /^\.github\/workflows\/[^/]+\.ya?ml$/.test(f))
    .map((file) => {
      const source = read(file)
      const triggers = [...source.matchAll(/^\s{2}([a-z_]+):/gm)]
        .map((m) => m[1])
        .filter((t) => ["push", "pull_request", "schedule", "workflow_dispatch", "workflow_run", "release"].includes(t))
      const uniqueTriggers = [...new Set(triggers)].sort()
      return {
        axis: "workflow",
        path: file,
        kind: source.includes(DISARM) ? "production-disarmed" : "no-aws-job-or-not-disarmed",
        fact: `triggers: ${uniqueTriggers.join(", ") || "(none parsed)"}`,
      }
    })
}

/* ────────────────────────────────────────────────────────────── axis G: tests */

/** The three runners this repository has, and how to tell which one owns a file. */
export function runnerFor(file) {
  if (file.startsWith("tests/")) return "node --test (npm run test:platform)"
  // `e2e/` anywhere in the path, not only at the root: `apps/system-studio/e2e`
  // is a Playwright project too, and calling its specs jest would send whoever
  // reads this row to a runner that never runs them.
  if (file.startsWith("e2e/") || file.includes("/e2e/")) return "playwright"
  return "jest (npm run test --workspace apps/web)"
}

function tests(files) {
  const roots = [...CONFIGURATION_ROOTS, "tests/"]
  return files
    .filter((f) => TEST_FILE.test(f))
    .filter((f) => roots.some((root) => f.startsWith(root)) || CONFIGURATION_FILE.test(f.replace(TEST_FILE, ".ts")))
    .filter((f) => f.startsWith("tests/") ? /config|authoriz|operator|entry-point/.test(f) : true)
    .sort()
    .map((file) => ({
      axis: "test",
      path: file,
      kind: runnerFor(file),
      fact: `${read(file).split("\n").length} lines`,
    }))
}

/* ──────────────────────────────────────────── axis H: deployed nonproduction */

/** Words a workflow would have to use to name a nonproduction deployment target. */
export const NONPRODUCTION_WORDS = /\b(staging|nonprod|non-production|nonproduction|preprod|sandbox)\b/i

export function nonproductionEvidence(files) {
  const envs = JSON.parse(read("infrastructure/oidc/environments.json") || '{"environments":[]}')
  const declared = (envs.environments ?? []).map((e) => e.name).sort()
  const nonProdEnvironments = declared.filter((n) => NONPRODUCTION_WORDS.test(n))

  const workflowFiles = files.filter((f) => /^\.github\/workflows\/[^/]+\.ya?ml$/.test(f))
  const nonProdWorkflows = workflowFiles.filter((f) => {
    // Only lines that could name a deployment target — an `environment:` key or
    // a job/step name. A comment mentioning "every preview environment" is not
    // a deployment target, and counting it would make this row lie.
    return read(f)
      .split("\n")
      .filter((line) => !line.trim().startsWith("#"))
      .some((line) => /^\s*environment:/.test(line) && NONPRODUCTION_WORDS.test(line))
  })

  return { declared, nonProdEnvironments, nonProdWorkflows: nonProdWorkflows.sort() }
}

function deployedNonproduction(files) {
  const e = nonproductionEvidence(files)
  return [
    {
      axis: "deployed-nonproduction",
      path: "infrastructure/oidc/environments.json",
      kind: "declared-environments",
      fact: `${e.declared.length} declared (${e.declared.join(", ")}); ${e.nonProdEnvironments.length} nonproduction`,
    },
    {
      axis: "deployed-nonproduction",
      path: ".github/workflows",
      kind: "deployment-targets",
      fact: `${e.nonProdWorkflows.length} workflows deploy to a nonproduction environment`,
    },
    {
      axis: "deployed-nonproduction",
      path: "docs/architecture/aws-current-state.md",
      kind: "read-only-estate-inventory",
      fact:
        "produced by tools/aws-inventory.mjs from .github/workflows/aws-inventory.yml; " +
        "records a single-account estate with Organizations not in use",
    },
  ]
}

/* ─────────────────────────────────────────────────────────────────── document */

export function inventory(files = trackedFiles()) {
  return [
    ...studioRoutes(files),
    ...authentication(files),
    ...configurationCode(files),
    ...databases(files),
    ...iac(files),
    ...workflows(files),
    ...tests(files),
    ...deployedNonproduction(files),
  ]
}

const AXIS_TITLES = {
  "studio-route": "System Studio routes",
  authentication: "Authentication and authorization modules",
  "configuration-code": "Configuration and form code",
  database: "Databases",
  iac: "Infrastructure as code",
  workflow: "Workflows",
  test: "Tests over the configuration surface",
  "deployed-nonproduction": "Deployed nonproduction behaviour",
}

const AXIS_NOTES = {
  "studio-route": "Every `page.tsx`, `route.ts`, `actions.ts` and `layout.tsx` under `apps/system-studio/src/app`. The authz column reports the vocabulary the file MENTIONS; `tests/security/cfg-one-authorization-path.test.mjs` is what turns that into a proof for the configurator surfaces.",
  authentication: "Matched by filename across both apps, so a new `rbac.ts` or `authorize.ts` cannot appear without showing up here.",
  "configuration-code": "The set `configurationModules()` computes, which is also the left-hand side of the CFG-000-003 disposition mapping — one derivation, so the two cannot disagree.",
  database: "Two stores, and they do not meet: Postgres is the tenant database and only `apps/web` reaches it; DynamoDB is the Studio's, and `tests/security/operator-plane-content.test.mjs` asserts the Studio imports no Prisma client.",
  iac: "Counted from the `resource`/`data` blocks in each file rather than from a plan, because a plan needs credentials and this must be derivable from a checkout.",
  workflow: "`production-disarmed` means the file carries `if: github.repository == 'Tenurework/Tenure'`. `no-aws-job-or-not-disarmed` is not an accusation — most of these never touch AWS. `tests/security/production-workflows-disarmed.test.mjs` is the guard that decides which is which.",
  test: "Which runner owns a file is decided by where it lives: `tests/**` is bare `node --test`, `e2e/**` is Playwright, everything else is jest.",
  "deployed-nonproduction": "This process holds no AWS credentials and describes no running environment. It establishes whether one exists to describe — see the header of `tools/cfg-configuration-truth.mjs` for why that is the answerable question, and what it is not.",
}

export function render(files = trackedFiles()) {
  const rows = inventory(files)
  const byAxis = new Map()
  for (const row of rows) {
    if (!byAxis.has(row.axis)) byAxis.set(row.axis, [])
    byAxis.get(row.axis).push(row)
  }

  const out = []
  out.push("# Configuration surface — current truth")
  out.push("")
  out.push(
    "**CFG-000-001.** Generated by `tools/cfg-configuration-truth.mjs` from `git ls-files`. " +
      "Do not edit by hand — `tests/architecture/cfg-configuration-truth-is-current.test.mjs` " +
      "regenerates this document and fails on any difference, and separately opens every path " +
      "below.",
  )
  out.push("")
  out.push(
    "No timestamp, no hostname and no absolute path appears here, and every count is taken " +
      "after normalising CRLF, so a Windows checkout and a Linux runner produce the same bytes.",
  )
  out.push("")
  out.push("| Axis | Rows |")
  out.push("|---|---:|")
  for (const axis of Object.keys(AXIS_TITLES)) {
    out.push(`| ${AXIS_TITLES[axis]} | ${(byAxis.get(axis) ?? []).length} |`)
  }
  out.push(`| **Total** | **${rows.length}** |`)
  out.push("")

  for (const axis of Object.keys(AXIS_TITLES)) {
    const axisRows = byAxis.get(axis) ?? []
    out.push(`## ${AXIS_TITLES[axis]}`)
    out.push("")
    out.push(AXIS_NOTES[axis])
    out.push("")
    out.push("| Path | Kind | Fact |")
    out.push("|---|---|---|")
    for (const row of axisRows) {
      out.push(`| \`${row.path}\` | ${row.kind} | ${row.fact.replace(/\|/g, "\\|")} |`)
    }
    out.push("")
  }

  out.push("## Finding on the ninth axis")
  out.push("")
  const e = nonproductionEvidence(files)
  out.push(
    e.nonProdEnvironments.length === 0 && e.nonProdWorkflows.length === 0
      ? "**There is no deployed nonproduction environment in this estate.** The deployment " +
          "roles trust " +
          e.declared.map((n) => `\`${n}\``).join(" and ") +
          " and nothing else; no workflow names a nonproduction deployment target; and the " +
          "read-only estate inventory records a single account with Organizations not in use. " +
          "So there is no nonproduction behaviour to inspect, which is a weaker and more " +
          "honest statement than \"nonproduction was inspected and found correct\". When " +
          "GE-010 vends a nonproduction account, this section changes and the guard reds until " +
          "somebody regenerates it and says what was actually observed."
      : "**A nonproduction deployment target now exists** — environments " +
          `${e.nonProdEnvironments.join(", ") || "(none)"}, workflows ${e.nonProdWorkflows.join(", ") || "(none)"}. ` +
          "Its behaviour is not described here: this generator reads the repository and holds " +
          "no credentials. CFG-000-001 must be re-evidenced against the running environment.",
  )
  out.push("")
  return out.join("\n")
}

/* ─────────────────────────────────────────────────────────────────────── CLI */

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (invokedDirectly) {
  const doc = render()
  const target = path.join(ROOT, OUT)
  if (process.argv.includes("--check")) {
    const current = fs.existsSync(target) ? fs.readFileSync(target, "utf8").replace(/\r\n/g, "\n") : ""
    if (current !== doc) {
      console.error(`::error::${OUT} is stale — run: node tools/cfg-configuration-truth.mjs`)
      process.exit(1)
    }
    console.log(`${OUT} is current`)
  } else {
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, doc)
    console.log(`wrote ${OUT}`)
  }
}
