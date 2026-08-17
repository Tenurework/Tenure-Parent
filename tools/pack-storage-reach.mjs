#!/usr/bin/env node
/**
 * PACK-010-003 — the measurement, not the fix.
 *
 * The requirement is "prevent pack direct access to another pack's private
 * storage or unauthorized tenant context". Before it can be prevented it has to
 * be counted, and nothing in this repository could count it until two pieces
 * landed independently:
 *
 *   * every module declares the Prisma models it governs — `objects` on
 *     `ModuleManifest`, enforced by `tests/architecture/module-objects.test.mjs`
 *     (PACK-040-002). That is the definition of "another pack's storage".
 *   * every source file belongs to exactly one platform domain —
 *     `tools/ownership-map.mjs` (GE-020-001). That is the definition of "which
 *     pack is reaching".
 *
 * This joins them: for every shipped file, every Prisma delegate it names, and
 * the module that claims that model, report the reaches that cross a boundary.
 *
 * ── Why this is a report and not a gate ──────────────────────────────────────
 *
 * Because the answer is not zero, and it is not close to zero. Committing a
 * failing gate breaks the build for everybody; committing a passing gate with a
 * hundred-odd exemptions is a list nobody will ever read. So this prints the
 * number and the sites, PACK-010-003 stays FAIL in
 * `docs/implementation/erp-pack-factory-execution-ledger.md` with that number
 * in it, and the gate is written by whoever closes the requirement — against
 * this instrument, so the number they claim is the number this prints.
 *
 * ── What it can and cannot see ───────────────────────────────────────────────
 *
 * Ownership is per DOMAIN, and three modules share `erp-modules`
 * (`resources`, `budgeting`, `reimbursements`). A budgeting page reading a
 * reimbursement row is therefore NOT reported: the domain matches. The count is
 * a floor, never a ceiling.
 *
 * It is lexical. `db.budgetLine.findMany(...)` is a reach; a helper that takes a
 * `PrismaClient` and is called with a delegate name from a variable is not
 * visible, and neither is raw SQL. Again: a floor.
 *
 * Usage:  node tools/pack-storage-reach.mjs [--json]
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { ROOT, modules } from './pack-surface-inventory.mjs'
import { classify } from './ownership-map.mjs'

const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n')

const byString = (a, b) => (a < b ? -1 : a > b ? 1 : 0)

const IS_TEST = /\.(test|itest|spec)\.tsx?$/

/** Comments stripped: a model named in prose is not a model queried. */
const code = (text) =>
  text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((l) => !/^\s*(\/\/|\*)/.test(l))
    .join('\n')

/** `LedgerEntry` → `ledgerEntry`, which is what the client exposes. */
const delegate = (model) => model[0].toLowerCase() + model.slice(1)

/**
 * The clients a delegate is reached through in this tree.
 *
 * `db` is the shared client (`apps/web/src/lib/db.ts`), `tx` the transaction
 * handle inside `$transaction`, and `prisma` the name used where a client is
 * constructed locally.
 */
const CLIENTS = ['prisma', 'db', 'tx', 'client']

export function reaches() {
  const manifests = modules()
  /** model → the module that claims it. */
  const owners = new Map()
  for (const m of manifests) for (const model of m.objects ?? []) owners.set(model, m)
  if (owners.size < 20) {
    throw new Error(`only ${owners.size} governed models read from modules/index.ts — the parse is broken`)
  }

  const { byDomain } = classify()
  /** file → the domain that owns it. */
  const domainOf = new Map()
  for (const [domain, files] of byDomain) for (const f of files) domainOf.set(f, domain)

  /** delegate name → {model, module}. */
  const byDelegate = new Map([...owners.entries()].map(([model, module]) => [delegate(model), { model, module }]))

  const found = []
  for (const [file, domain] of domainOf) {
    if (IS_TEST.test(file)) continue
    const abs = path.join(ROOT, file)
    // The ownership map lists what git knows; a file deleted in the working
    // tree is not a finding, it is a stale listing.
    if (!fs.existsSync(abs)) continue
    const text = code(read(file))
    const named = new Set()
    for (const m of text.matchAll(/\b([a-zA-Z_$][\w$]*)\s*\.\s*([a-z][A-Za-z0-9]*)\s*\./g)) {
      if (CLIENTS.includes(m[1])) named.add(m[2])
    }
    for (const name of [...named].sort(byString)) {
      const hit = byDelegate.get(name)
      if (!hit) continue
      if (hit.module.owner === domain) continue
      found.push({
        file,
        domain,
        model: hit.model,
        module: hit.module.key,
        moduleDomain: hit.module.owner,
      })
    }
  }

  found.sort((a, b) => byString(`${a.file}|${a.model}`, `${b.file}|${b.model}`))

  const files = new Set(found.map((r) => r.file))
  const modelsReached = new Set(found.map((r) => r.model))
  return {
    reaches: found,
    counts: {
      reaches: found.length,
      files: files.size,
      modelsReached: modelsReached.size,
      governedModels: owners.size,
      modules: manifests.length,
    },
  }
}

function main() {
  const result = reaches()
  if (process.argv.includes('--json')) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n')
    return
  }
  const c = result.counts
  console.log(
    `${c.reaches} cross-domain storage reaches, in ${c.files} files, over ${c.modelsReached} of ` +
      `${c.governedModels} governed models (${c.modules} modules).`,
  )
  for (const r of result.reaches) {
    console.log(`  ${r.file} [${r.domain}] -> ${r.model} (${r.module}, ${r.moduleDomain})`)
  }
  console.log('')
  console.log('PACK-010-003 is FAIL. This is a measurement, not a gate: see the tool docstring.')
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
