#!/usr/bin/env node
/**
 * PACK-000-001 — inventory every existing module, route, schema, service,
 * feature flag, integration and tenant customization.
 *
 * The Pack Factory Bible §3 says packs build over one platform kernel and may
 * not create parallel foundations. That sentence is unfalsifiable until somebody
 * can say what the surface actually IS today — which modules exist, what they
 * serve, which tables they hang off, which workspaces provide the primitives,
 * what can be flipped, what reaches outside the platform, and where a tenant is
 * allowed to differ. PACK-000-001 asks for exactly that list, and this generates
 * it from the tree rather than from memory.
 *
 * ## Why a generator and not a document
 *
 * A hand-written inventory is accurate the day it is written and wrong from the
 * next commit. Worse, it is *plausible* while wrong, which is the failure mode
 * this programme keeps hitting: a list assembled from a Bible's own wording,
 * describing code nobody has. Every row below names a path, and
 * `tests/architecture/pack-surface-inventory.test.mjs` opens each one.
 *
 * ## Byte-identical on Linux and Windows
 *
 * Everything that could differ by checkout is pinned:
 *
 *   * paths are POSIX (`git ls-files` speaks POSIX; `path.posix` keeps it so);
 *   * every collection is sorted with a fixed comparator, never left in
 *     `readdirSync` or `git` order;
 *   * files are read with CRLF collapsed to LF before anything is matched or
 *     counted, so a Windows checkout with `core.autocrlf=true` produces the
 *     same rows as a Linux one;
 *   * the output carries no timestamp, no hostname and no absolute path.
 *
 * Usage:  node tools/pack-surface-inventory.mjs [--check]
 *   --check  exit non-zero if the committed documents are out of date
 */
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const JSON_PATH = 'docs/architecture/pack-surface-inventory.json'
export const MD_PATH = 'docs/architecture/pack-surface-inventory.md'

/** Read a tracked file with line endings normalised. Never hash or match raw CRLF. */
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n')
const exists = (p) => fs.existsSync(path.join(ROOT, p))

/** One comparator for every sort in this file, so ordering cannot vary by locale. */
const byString = (a, b) => (a < b ? -1 : a > b ? 1 : 0)
const sorted = (xs) => [...xs].sort(byString)
const sortedBy = (xs, key) => [...xs].sort((a, b) => byString(key(a), key(b)))

/**
 * Tracked files only, POSIX, sorted.
 *
 * Deliberately NOT `--others`. An inventory that included untracked files would
 * describe whoever's working tree generated it: two people with different
 * uncommitted work would produce two different committed documents from the same
 * commit, which is the checkout-dependence failure this file's header promises
 * not to have. An untracked file is not yet part of the repository, and the
 * generator's `--check` runs in CI against a clean checkout where everything
 * that exists is tracked — so nothing real is missed, and the artefact stops
 * depending on who ran it.
 *
 * Tracked-listing also excludes `.next/` and `node_modules/` for free, which
 * matters because `apps/web/.next/types/app/**` contains route-shaped files that
 * are not routes.
 */
function listFiles(glob) {
  const out = execFileSync('git', ['ls-files', '--cached', glob], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  })
  return sorted(
    out
      .split('\n')
      .map((f) => f.trim())
      .filter(Boolean)
      // The index still lists a file deleted in the worktree and not yet staged.
      // Reading it throws and takes down the whole inventory rather than losing
      // one row, and it is not a surface: nothing serves it.
      .filter((f) => exists(f)),
  )
}

/**
 * The body of the object literal opening at or after `from`, by brace matching.
 *
 * Not a TypeScript parser, and it does not need to be — it needs to be right
 * about the twelve manifests, twenty-four provider packs and sixteen domains
 * that are actually here, and to fail loudly rather than quietly if that stops
 * being true. The consuming test asserts a non-zero count for every section, so
 * a match that silently returns nothing reds instead of shrinking a table.
 */
function braceBlock(text, from) {
  const open = text.indexOf('{', from)
  if (open === -1) return ''
  let depth = 0
  for (let i = open; i < text.length; i++) {
    const c = text[i]
    if (c === '{') depth++
    else if (c === '}' && --depth === 0) return text.slice(open, i + 1)
  }
  return ''
}

/** `field: "value"` inside a block. */
const field = (block, name) => new RegExp(`\\b${name}:\\s*"([^"]*)"`).exec(block)?.[1] ?? null

/** `field: ["a", "b"]` inside a block, sorted. */
function stringArrayField(block, name) {
  const m = new RegExp(`\\b${name}:\\s*\\[([\\s\\S]*?)\\]`).exec(block)
  if (!m) return []
  return sorted([...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]))
}

// ── 1. modules ──────────────────────────────────────────────────────────────

/**
 * The module catalog, from `modules/index.ts`.
 *
 * `key` is the identity every other artefact refers to a module by — the
 * blueprint that selects it, the plan that entitles it, the release that pins
 * it. `objects` is the module's claim on the schema and is the half this
 * inventory can cross-check: the consuming test asserts every name is a model
 * `apps/web/prisma/schema.prisma` actually declares.
 */
export const MODULES_SOURCE = 'modules/index.ts'

export function modules() {
  const text = read(MODULES_SOURCE)
  const out = []
  for (const m of text.matchAll(/const\s+\w+\s*:\s*ModuleManifest\s*=\s*/g)) {
    const block = braceBlock(text, m.index)
    const key = field(block, 'key')
    if (!key) continue
    out.push({
      key,
      name: field(block, 'name'),
      version: field(block, 'version'),
      owner: field(block, 'owner'),
      lifecycle: field(block, 'lifecycle'),
      mode: field(block, 'mode'),
      objects: stringArrayField(block, 'objects'),
      permissions: stringArrayField(block, 'permissions'),
      navigationHrefs: sorted([...block.matchAll(/\bhref:\s*"([^"]+)"/g)].map((x) => x[1])),
      source: MODULES_SOURCE,
    })
  }
  return sortedBy(out, (r) => r.key)
}

// ── 2. routes ───────────────────────────────────────────────────────────────

/**
 * Every route either app serves, with the experience that reaches it.
 *
 * Two apps, deliberately named separately: both serve `/signin`, so an
 * unqualified route list is ambiguous and an allowlist written against it would
 * cover the operator console by accident. `apps/system-studio` is the deployer
 * console and holds the highest privilege in the estate; a pack inventory that
 * counted only the tenant app would be counting half the platform.
 *
 * Route groups (`(app)`, `(marketing)`) are stripped because they are a
 * filesystem organisation device and never appear in a URL.
 */
export const ROUTE_ROOTS = [
  { experience: 'tenant', app: 'apps/web', appRoot: 'apps/web/src/app' },
  { experience: 'deployer', app: 'apps/system-studio', appRoot: 'apps/system-studio/src/app' },
]

const urlOf = (file, appRoot) => {
  const rel = file.slice(appRoot.length).replace(/\/(page|route)\.tsx?$/, '')
  const stripped = rel
    .split('/')
    .filter((seg) => !/^\(.*\)$/.test(seg))
    .join('/')
  return stripped === '' ? '/' : stripped
}

export function routes() {
  const out = []
  for (const { experience, app, appRoot } of ROUTE_ROOTS) {
    for (const file of listFiles(`${appRoot}/**`)) {
      const base = path.posix.basename(file)
      if (!/^(page|route)\.tsx?$/.test(base)) continue
      const kind = base.startsWith('route') ? 'api' : 'page'
      const methods =
        kind === 'api'
          ? sorted(
              [
                ...read(file).matchAll(
                  /^export\s+(?:async\s+)?(?:function|const)\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/gm,
                ),
              ].map((m) => m[1]),
            )
          : []
      out.push({ experience, app, kind, url: urlOf(file, appRoot), methods, source: file })
    }
  }
  return sortedBy(out, (r) => `${r.experience}\u0000${r.kind}\u0000${r.url}\u0000${r.source}`)
}

// ── 3. schema ───────────────────────────────────────────────────────────────

/**
 * Every model the tenant database declares, and whether it is tenant-scoped.
 *
 * `tenantScoped` is a structural fact — the model carries an `institutionId`
 * column — not a policy claim. It says which tables a pack could reach across a
 * tenant boundary if nothing stopped it, which is the question PACK-010-003
 * will need answered and which no document in the repository answered before.
 */
export const SCHEMA_SOURCE = 'apps/web/prisma/schema.prisma'

export function schemaModels() {
  const text = read(SCHEMA_SOURCE)
  const out = []
  for (const m of text.matchAll(/^model\s+(\w+)\s*\{/gm)) {
    const block = braceBlock(text, m.index)
    const fields = [...block.matchAll(/^\s{2}(\w+)\s+\S/gm)].map((f) => f[1])
    out.push({
      model: m[1],
      fieldCount: fields.length,
      tenantScoped: fields.includes('institutionId'),
      source: SCHEMA_SOURCE,
    })
  }
  return sortedBy(out, (r) => r.model)
}

// ── 4. services ─────────────────────────────────────────────────────────────

/**
 * Every workspace: the apps, the platform packages, the blueprint set and the
 * module catalog.
 *
 * "Service" is read as "a unit of the product line that ships as its own
 * workspace", because that is the boundary this repository actually has — there
 * are no separately deployed services beyond the two apps, and inventing a
 * services layer that is not here is precisely the fabrication this item exists
 * to prevent. `dependsOn` is the declared edge between them, which is what makes
 * the kernel/pack direction checkable at all.
 */
export function services() {
  const manifests = listFiles('**/package.json').filter(
    (f) => f !== 'package.json' && !f.includes('node_modules/'),
  )
  const out = []
  for (const f of manifests) {
    let pkg
    try {
      pkg = JSON.parse(read(f))
    } catch {
      continue
    }
    out.push({
      dir: path.posix.dirname(f),
      name: pkg.name ?? '(unnamed)',
      private: pkg.private === true,
      dependsOn: sorted(
        Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).filter((d) =>
          d.startsWith('@tenure/'),
        ),
      ),
      source: f,
    })
  }
  return sortedBy(out, (r) => r.dir)
}

// ── 5. feature flags ────────────────────────────────────────────────────────

/**
 * Every flag the platform ships, from the one registry that declares them.
 *
 * There is exactly one, and that number is the point: a flag with no consumer is
 * a declaration pretending to be a control. Recording the registry's own count
 * means a second flag added without a consumer shows up in a diff of this file
 * rather than nowhere.
 */
export const FLAGS_SOURCE = 'packages/platform-config/src/flags.ts'

export function featureFlags() {
  const text = read(FLAGS_SOURCE)
  // `export const FLAG_NAMES = [...] as const` — an assignment, not an object
  // field, so the generic `field: [...]` reader does not see it. It read zero
  // for exactly that reason, and zero flags is indistinguishable from "no flag
  // registry", which is why the consuming test asserts the count is non-zero.
  const names = sorted(
    [
      ...(/\bFLAG_NAMES\s*=\s*\[([\s\S]*?)\]/.exec(text)?.[1] ?? '').matchAll(/"([^"]+)"/g),
    ].map((m) => m[1]),
  )
  const killKey = /FLAG_KILL_LIST_KEY\s*=\s*"([^"]+)"/.exec(text)?.[1] ?? null
  return {
    source: FLAGS_SOURCE,
    killListKey: killKey,
    flags: names.map((name) => ({
      name,
      enabledKey: `platform.flags.${name}.enabled`,
      rolloutKey: `platform.flags.${name}.rolloutPercent`,
      source: FLAGS_SOURCE,
    })),
  }
}

// ── 6. integrations ─────────────────────────────────────────────────────────

/**
 * Every provider pack: what the platform can talk to outside itself.
 *
 * `egressHosts` is carried because it is the only field here that is a security
 * boundary rather than a label — a host absent from a pack's list is an egress
 * nobody reviewed, and the pack is refused for it.
 */
export const PROVIDER_PACKS_SOURCE = 'packages/provisioning/src/provider-packs.ts'

export function integrations() {
  const text = read(PROVIDER_PACKS_SOURCE)
  const start = text.indexOf('export const PROVIDER_PACKS')
  const list = start === -1 ? '' : text.slice(start)
  const out = []
  for (const m of list.matchAll(/\bpack\(/g)) {
    const block = braceBlock(list, m.index)
    const key = field(block, 'key')
    if (!key) continue
    out.push({
      key,
      displayName: field(block, 'displayName'),
      provider: field(block, 'provider'),
      product: field(block, 'product'),
      capability: field(block, 'capability'),
      direction: field(block, 'direction'),
      egressHosts: stringArrayField(block, 'egressHosts'),
      requirementIds: stringArrayField(block, 'requirementIds'),
      source: PROVIDER_PACKS_SOURCE,
    })
  }
  return sortedBy(out, (r) => r.key)
}

// ── 7. tenant customization ─────────────────────────────────────────────────

/**
 * Every way one tenant's system may differ from another's.
 *
 * Three mechanisms, and they are genuinely different:
 *
 *   * a CONFIGURATION LAYER is where a value may be overridden, and the layer
 *     kind decides precedence;
 *   * a CONFIGURATION DOMAIN is what may be overridden, and `tenantAdminMayWrite`
 *     is the difference between "an operator can change this for a customer" and
 *     "the customer can change it themselves" — collapsing the two is how
 *     "configurable" becomes "the customer can move their own students to
 *     another continent";
 *   * a BLUEPRINT is the archetype starting point a tenant is composed from.
 *
 * Anything a tenant can vary that is not one of these three is a fork, which is
 * exactly what PACK-010-004 forbids. Listing the legitimate mechanisms is what
 * makes that a checkable statement instead of a slogan.
 */
export const LAYERS_SOURCE = 'packages/configuration/src/layer-schema.ts'
export const DOMAINS_SOURCE = 'packages/configuration/src/domains.ts'

export function tenantCustomization() {
  const layerText = read(LAYERS_SOURCE)
  const layerKinds = [
    ...(/export const LAYER_KINDS\s*=\s*\[([\s\S]*?)\]\s*as const/.exec(layerText)?.[1] ?? '').matchAll(
      /"([^"]+)"/g,
    ),
  ].map((m) => m[1])

  const domainText = read(DOMAINS_SOURCE)
  const domains = []
  for (const m of domainText.matchAll(/^\s{4}id:\s*"([^"]+)",$/gm)) {
    const blockStart = domainText.lastIndexOf('{', m.index)
    const block = braceBlock(domainText, blockStart)
    domains.push({
      id: m[1],
      prefixes: stringArrayField(block, 'prefixes'),
      status: field(block, 'status'),
      tenantAdminMayWrite: /\btenantAdminMayWrite:\s*true\b/.test(block),
      source: DOMAINS_SOURCE,
    })
  }

  const blueprints = listFiles('blueprints/**')
    .filter((f) => /^blueprints\/[^/]+\/blueprint\.ts$/.test(f))
    .map((f) => ({ id: f.split('/')[1], source: f }))

  return {
    // Precedence order is data in the source and stays in source order here —
    // sorting it would destroy the one fact it carries.
    configurationLayers: layerKinds.map((kind, rank) => ({ kind, rank, source: LAYERS_SOURCE })),
    configurationDomains: sortedBy(domains, (d) => d.id),
    blueprints: sortedBy(blueprints, (b) => b.id),
  }
}

// ── assembly ────────────────────────────────────────────────────────────────

export function inventory() {
  return {
    requirement: 'PACK-000-001',
    generatedBy: 'tools/pack-surface-inventory.mjs',
    modules: modules(),
    routes: routes(),
    schemaModels: schemaModels(),
    services: services(),
    featureFlags: featureFlags(),
    integrations: integrations(),
    tenantCustomization: tenantCustomization(),
  }
}

/** Every path any row cites, deduplicated. What the consuming test opens. */
export function citedPaths(inv) {
  const out = new Set()
  const walk = (node) => {
    if (Array.isArray(node)) return node.forEach(walk)
    if (node && typeof node === 'object') {
      for (const [k, v] of Object.entries(node)) {
        if (k === 'source' && typeof v === 'string') out.add(v)
        else walk(v)
      }
    }
  }
  walk(inv)
  return sorted([...out])
}

const table = (headers, rows) =>
  [
    `| ${headers.join(' | ')} |`,
    `|${headers.map(() => '---').join('|')}|`,
    ...rows.map((r) => `| ${r.join(' | ')} |`),
  ].join('\n')

const code = (s) => (s === null || s === undefined || s === '' ? '—' : `\`${s}\``)
const list = (xs) => (xs.length === 0 ? '—' : xs.map((x) => `\`${x}\``).join(' '))

function markdown(inv) {
  const { modules: mods, routes: rts, schemaModels: models, services: svcs } = inv
  const flags = inv.featureFlags
  const ints = inv.integrations
  const cust = inv.tenantCustomization
  const tenantRoutes = rts.filter((r) => r.experience === 'tenant')
  const deployerRoutes = rts.filter((r) => r.experience === 'deployer')

  return `<!-- Generated by tools/pack-surface-inventory.mjs. Do not edit by hand. -->
# Pack surface inventory

PACK-000-001. Every module, route, schema model, service, feature flag,
integration and tenant-customization mechanism that exists in this repository
today — derived from the tree, never written by hand.

Regenerate with \`node tools/pack-surface-inventory.mjs\`.
\`tests/architecture/pack-surface-inventory.test.mjs\` fails if the committed copy
is stale, if any row cites a path that is not there, or if a module claims a
schema model the database does not declare.

**${mods.length} modules · ${rts.length} routes (${tenantRoutes.length} tenant, ${deployerRoutes.length} deployer) · ${models.length} schema models · ${svcs.length} workspaces · ${flags.flags.length} feature flag${flags.flags.length === 1 ? '' : 's'} · ${ints.length} provider packs · ${cust.configurationLayers.length} configuration layers · ${cust.configurationDomains.length} configuration domains · ${cust.blueprints.length} blueprints.**

This is an inventory of what EXISTS, not a claim about what works. Every module
below is \`certified-limited\` — Bible §6's name for a capability that runs and is
supported and carries a stated list of what it does not do. Read
\`docs/architecture/capability-completeness-registry.yaml\` for the per-dimension
verdicts; this file answers the prior question, which is what there is to assess.

## 1. Modules

Source: \`${MODULES_SOURCE}\`. \`objects\` is the module's claim on the schema, and
it is checked: every name must be a model in \`${SCHEMA_SOURCE}\`.

${table(
  ['Key', 'Name', 'Owner domain', 'Lifecycle', 'Mode', 'Objects', 'Permissions', 'Navigation'],
  mods.map((m) => [
    code(m.key),
    m.name ?? '—',
    code(m.owner),
    code(m.lifecycle),
    code(m.mode),
    String(m.objects.length),
    String(m.permissions.length),
    list(m.navigationHrefs),
  ]),
)}

## 2. Routes

Two experiences. \`tenant\` is what a customer signs into and is scoped to one
institution; \`deployer\` is the console Tenure staff operate the estate from and
is scoped to none. Route groups such as \`(app)\` are stripped — they organise the
filesystem and never appear in a URL.

${table(
  ['Experience', 'Kind', 'URL', 'Methods', 'File'],
  rts.map((r) => [r.experience, r.kind, code(r.url), r.methods.join(' ') || '—', code(r.source)]),
)}

## 3. Schema models

Source: \`${SCHEMA_SOURCE}\`. \`Tenant-scoped\` means the model carries an
\`institutionId\` column — a structural fact about the table, not a claim that a
policy enforces it.

${table(
  ['Model', 'Fields', 'Tenant-scoped'],
  models.map((m) => [code(m.model), String(m.fieldCount), m.tenantScoped ? 'yes' : 'no']),
)}

## 4. Services

Every workspace in the monorepo. There is no separately deployed service beyond
the two apps, and \`dependsOn\` is the declared edge between workspaces — the
thing that makes "packs build over the kernel" a direction something can check.

${table(
  ['Directory', 'Package', 'Depends on'],
  svcs.map((s) => [code(s.dir), code(s.name), list(s.dependsOn)]),
)}

## 5. Feature flags

Source: \`${FLAGS_SOURCE}\`. A flag here may only RESTRICT: the platform default is
the ceiling and every lower layer can only lower it. Kill list key:
${code(flags.killListKey)}.

${table(
  ['Flag', 'Enabled key', 'Rollout key'],
  flags.flags.map((f) => [code(f.name), code(f.enabledKey), code(f.rolloutKey)]),
)}

## 6. Integrations

Source: \`${PROVIDER_PACKS_SOURCE}\`. These are the provider packs the platform
declares — what it can talk to outside itself, and the exact hosts it may reach
to do it.

${table(
  ['Key', 'Provider', 'Product', 'Capability', 'Direction', 'Egress hosts', 'Requirements'],
  ints.map((i) => [
    code(i.key),
    code(i.provider),
    code(i.product),
    code(i.capability),
    code(i.direction),
    list(i.egressHosts),
    list(i.requirementIds),
  ]),
)}

## 7. Tenant customization

Every legitimate way one tenant's system may differ from another's. Anything a
tenant can vary that is not one of these is a fork, which is what PACK-010-004
forbids — so this table is what makes that a checkable statement.

### 7.1 Configuration layers

Source: \`${LAYERS_SOURCE}\`. Listed in precedence order, lowest rank first.

${table(
  ['Rank', 'Layer kind'],
  cust.configurationLayers.map((l) => [String(l.rank), code(l.kind)]),
)}

### 7.2 Configuration domains

Source: \`${DOMAINS_SOURCE}\`. \`Tenant admin may write\` is deliberately separate
from which layers may write: an operator changing a value on a customer's behalf
and the customer changing it themselves are different acts with different blast
radii.

${table(
  ['Domain', 'Prefixes', 'Status', 'Tenant admin may write'],
  cust.configurationDomains.map((d) => [
    code(d.id),
    list(d.prefixes),
    code(d.status),
    d.tenantAdminMayWrite ? 'yes' : 'no',
  ]),
)}

### 7.3 Blueprints

${table(
  ['Blueprint', 'File'],
  cust.blueprints.map((b) => [code(b.id), code(b.source)]),
)}
`
}

// ── entry point ─────────────────────────────────────────────────────────────

export function render() {
  const inv = inventory()
  return { json: JSON.stringify(inv, null, 2) + '\n', md: markdown(inv), inv }
}

function main() {
  const check = process.argv.includes('--check')
  const { json, md } = render()
  const targets = [
    [JSON_PATH, json],
    [MD_PATH, md],
  ]

  if (check) {
    const stale = targets.filter(([p, want]) => !exists(p) || read(p) !== want).map(([p]) => p)
    if (stale.length > 0) {
      // `::error::` so CI annotates the run, matching every other generator here.
      for (const p of stale) {
        console.error(`::error::${p} is stale. Run: node tools/pack-surface-inventory.mjs`)
      }
      console.error(
        '::error::This generator is not in the root `generate` script — `package.json` is shared ' +
          'and was not this domain\'s to edit. Adding `&& node tools/pack-surface-inventory.mjs` ' +
          'to it makes this regenerate with the others.',
      )
      process.exit(1)
    }
    console.log('pack-surface-inventory: current')
    return
  }

  for (const [p, content] of targets) {
    fs.writeFileSync(path.join(ROOT, p), content)
    console.log(`wrote ${p}`)
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
