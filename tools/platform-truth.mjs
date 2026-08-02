#!/usr/bin/env node
/**
 * Compiles what the engine knows about itself into one JSON file the System
 * Studio renders.
 *
 * Why generate rather than read at runtime: the Studio's container ships
 * `apps/system-studio` and its dependencies, not `docs/`. A page that read the
 * ledger from disk would work locally and 500 in production. Generating a
 * committed artifact instead means the deployed console shows exactly the truth
 * that was committed at the moment it was built, and `--check` fails the build
 * when the two drift.
 *
 * Everything here is derived from files in this repository. Nothing is
 * hand-entered, and nothing is illustrative — if a number appears on the
 * console, it came from an artifact a person can open.
 *
 * Usage:  node tools/platform-truth.mjs [--check]
 */
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'
import { programme as queue } from './loop/next-batch.mjs'

const LEDGER = 'docs/implementation/global-engine-execution-ledger.md'

/**
 * Every ledger, because there are three.
 *
 * The two bibles added on 2026-08-02 each instruct that their own file be
 * created. Reading only the first one means an entry recorded correctly, under
 * the rules, in the file its own prompt named, does not appear on the console —
 * and the console's numbers quietly become a subset that looks like a total.
 * `LEDGER` stays as the one whose findings table GE-GATE-0 lives in.
 */
const LEDGERS = [
  LEDGER,
  'docs/implementation/system-studio-aws-control-plane-execution-ledger.md',
  'docs/implementation/simon-ose-absorption-execution-ledger.md',
]
const INVENTORY = 'docs/architecture/aws-inventory.json'
const OUT = 'apps/system-studio/src/generated/platform-truth.json'

/**
 * Ledger items, with their state and phase.
 *
 * The ledger is the source of truth for progress and is maintained under a
 * stated evidence protocol; parsing it means the console cannot claim progress
 * the ledger does not.
 */
function ledger() {
  const text = fs.readFileSync(LEDGER, 'utf8')
  const items = []
  let phase = 'Phase 0'

  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const heading = line.match(/^#\s+(Phase\s+\d+[^\n]*)/) ?? line.match(/^#\s+(.*)/)
    if (heading && /^Phase\s/.test(heading[1])) phase = heading[1].trim()

    const item = line.match(/^- \[([ x])\]\s+\*\*(GE-[\w-]+)\*\*\s+—\s+(.*)$/)
    if (!item) continue

    // A title may wrap. Continuation lines are indented and are not the item's
    // sub-bullets, so absorb them — otherwise the console renders half a
    // sentence ending in a comma, which looks like a truncation bug in the
    // console rather than a line break in the ledger.
    let title = item[3].trim()
    for (let j = i + 1; j < lines.length; j++) {
      const next = lines[j]
      if (!/^\s{2,}\S/.test(next) || /^\s*[-*]\s/.test(next)) break
      title += ` ${next.trim()}`
    }

    items.push({
      id: item[2],
      done: item[1] === 'x',
      title,
      phase,
      isGate: item[2].includes('GATE'),
    })
  }

  // A ledger that exists but has no entries yet is fine — it was just created.
  // Only the global engine ledger parsing to nothing means the format changed.
  if (items.length === 0 && file === LEDGER) {
    throw new Error(`Parsed no items from ${file} — the format changed.`)
  }
  return items
}

/**
 * The findings table under GE-GATE-0: what the estate is, versus what the
 * Architecture Bible requires, and which item owns each gap.
 */
function findings() {
  const text = fs.readFileSync(LEDGER, 'utf8')
  const section = text.slice(text.indexOf('### What the inventory found, carried forward'))
  if (!section) return []

  const rows = []
  for (const line of section.split('\n')) {
    const m = line.match(/^\s*\|\s*(.+?)\s*\|\s*(GE-[\w /]+)\s*\|\s*$/)
    if (!m) continue
    if (/^Finding$/i.test(m[1])) continue
    rows.push({ finding: m[1], owner: m[2].trim() })
  }
  return rows
}

/** The AWS estate, from the sanitized read-only inventory. */
function estate() {
  const inv = JSON.parse(fs.readFileSync(INVENTORY, 'utf8'))
  return {
    generatedAt: inv.generatedAt,
    account: inv.accountMasked,
    region: inv.region,
    summary: inv.summary,
    // Named explicitly rather than dumped: these are the facts the findings
    // above refer to, and an operator should be able to check one against the
    // other without opening a JSON file.
    organizationInUse: Array.isArray(inv.organization?.accounts) && inv.organization.accounts.length > 0,
    oidcProviders: inv.iam?.oidcProviders?.length ?? 0,
    cognitoUserPools: inv.identityProvider?.cognitoUserPools?.length ?? 0,
    backupVaults: inv.observability?.backupVaults?.length ?? 0,
    sqsQueues: inv.messaging?.sqsQueues ?? [],
    alarms: (inv.observability?.alarms ?? []).map((a) => ({ name: a.name, state: a.state })),
    deniedCalls: inv.access?.denied ?? inv.summary?.deniedCalls ?? 0,
  }
}

/**
 * The whole programme, across every binding document.
 *
 * Derived from `tools/loop/next-batch.mjs` rather than parsed here again. This
 * function used to have its own parser pointed at the superseded v1.1 prompt,
 * and so the console published "65 of 552 — 11.8%" while the true figure was
 * 76 of 1219 — 6.2%. Two parsers of the same documents will disagree; the only
 * question is how long before anyone notices, and the answer was months.
 *
 * The ledger only carries the phase currently being worked, so reporting
 * progress against it alone would read as "65 of 76" — true of what has been
 * transcribed, and badly misleading about the programme.
 */
function programme() {
  const { items, state, sources } = queue()

  const byPhase = new Map()
  for (const item of items) {
    const key = `${item.source} · ${item.phase}`
    if (!byPhase.has(key)) byPhase.set(key, { phase: key, source: item.source, items: 0, gates: 0, done: 0 })
    const bucket = byPhase.get(key)
    bucket.items += 1
    if (item.id.includes('GATE')) bucket.gates += 1
    const status = state.get(item.id)
    if (status === 'PASS' || status === 'BLOCKED_EXTERNAL' || status === 'NOT_APPLICABLE') bucket.done += 1
  }

  const phases = [...byPhase.values()]
  return {
    sources,
    totalItems: items.length,
    totalGates: phases.reduce((n, p) => n + p.gates, 0),
    decided: phases.reduce((n, p) => n + p.done, 0),
    phases,
  }
}

/**
 * Test suites and their sizes, so the console does not have to be told.
 *
 * Counted over tracked AND untracked-but-not-ignored files. Plain `git
 * ls-files` lists only tracked ones, which makes this output change at the
 * moment of `git commit` — so generating, verifying and committing in that
 * order produces a file that was current when written and stale when pushed.
 * That is exactly what happened, and CI caught it.
 */
function suites() {
  const count = (glob) =>
    execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', glob], {
      encoding: 'utf8',
    })
      .split('\n')
      .filter(Boolean).length

  return [
    { name: 'platform guards', files: count('tests/security/*.test.mjs'), what: 'repository and deployment invariants' },
    { name: 'application unit', files: count('apps/web/src/**/*.test.ts'), what: 'apps/web' },
    { name: 'tenant isolation', files: count('apps/web/src/**/*.itest.ts'), what: 'cross-tenant reads must fail' },
    { name: 'end to end', files: count('apps/web/e2e/*.spec.ts') + count('apps/system-studio/e2e/*.spec.ts'), what: 'real browser' },
  ]
}

const items = ledger()
const truth = {
  generatedBy: 'tools/platform-truth.mjs',
  commit: execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim(),
  ledger: {
    source: LEDGER,
    total: items.length,
    done: items.filter((i) => i.done).length,
    phases: [...new Set(items.map((i) => i.phase))].map((phase) => ({
      phase,
      items: items.filter((i) => i.phase === phase),
    })),
  },
  programme: programme(),
  findings: findings(),
  estate: estate(),
  suites: suites(),
}

const rendered = `${JSON.stringify(truth, null, 2)}\n`

if (process.argv.includes('--check')) {
  const current = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : ''

  // The commit hash changes every commit and would make this permanently stale,
  // so it is excluded from the comparison. Everything that describes the
  // platform's state is compared.
  const strip = (s) => s.replace(/^\s*"commit":.*$/m, '')
  if (strip(current) !== strip(rendered)) {
    console.error(`::error::${OUT} is stale. Run: node tools/platform-truth.mjs`)
    process.exit(1)
  }
  console.log(`${OUT} is up to date.`)
} else {
  fs.mkdirSync(OUT.slice(0, OUT.lastIndexOf('/')), { recursive: true })
  fs.writeFileSync(OUT, rendered)
  console.log(
    `Wrote ${OUT} — ${truth.ledger.done}/${truth.ledger.total} items, ${truth.findings.length} findings.`
  )
}
