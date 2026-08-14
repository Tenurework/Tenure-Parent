/**
 * WRK-000-001 — the work-graph provider inventory is a claim about the tree,
 * and this is what makes it falsifiable.
 *
 * An inventory nobody re-derives is prose. The document
 * `docs/architecture/wrk-work-graph-inventory.md` says twenty-four providers
 * are declared, one is ever called, no declared OAuth redirect is served by any
 * route, and exactly one Relay tool exists. Every one of those sentences is
 * either true of the working tree or it is an overstatement of precisely the
 * kind invariant 3 of the Work Graph Bible exists to stop — "a provider is not
 * available because a UI card, SDK, API key, OAuth handshake, or test webhook
 * exists".
 *
 * So this does four separate things, and the fourth is the one that matters:
 *
 *   1. runs the generator's `--check`, which fails when the committed document
 *      and the tree disagree;
 *   2. refuses a scan that found nothing — a survey with an empty denominator
 *      reports "no violations" and is indistinguishable from a broken one;
 *   3. re-derives every citation in the document INDEPENDENTLY of the
 *      generator, by opening the cited file at the cited line and requiring the
 *      cited key to be there. A generator that emits a plausible table from its
 *      own imagination passes step 1 trivially and fails this;
 *   4. pins the two false positives that the first run of the generator
 *      actually produced — `/api/jobs/outbox` counted as a Box route, and
 *      `@aws-sdk/s3-request-presigner` counted as an Adobe SDK because the
 *      display name `Adobe Acrobat Sign` contributed the word `Sign`. Both read
 *      as evidence of a connector. A word-boundary matcher that stops matching
 *      them is the difference between this inventory and a keyword count.
 *
 * Plain `node --test` — this directory is run by `npm run test:platform`, which
 * has no TypeScript and no jest globals.
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { classify } from '../../tools/document-graph.mjs'
import { OUT, ROOT, collect, servesPath } from '../../tools/wrk-work-graph-inventory.mjs'

const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n')

test('the committed inventory matches the tree', () => {
  // The generator's own comparison, run as a subprocess so a non-zero exit is
  // the failure rather than something this file has to interpret.
  const result = execFileSync(
    process.execPath,
    [path.join(ROOT, 'tools/wrk-work-graph-inventory.mjs'), '--check'],
    { cwd: ROOT, encoding: 'utf8' },
  )
  assert.match(result, /is up to date/)
})

test('the scan found a repository, not an empty set', () => {
  const i = collect()
  // Reasoned floors, not the current values: each is well below what the tree
  // holds and well above what a broken glob would return. A scan that silently
  // matched nothing would report every axis as "no" and read as a clean bill of
  // health.
  assert.ok(
    i.perProvider.length >= 20,
    `only ${i.perProvider.length} providers parsed from the pack catalog — the parse is broken, not the catalog`,
  )
  assert.ok(
    i.routeRows.length >= 20,
    `only ${i.routeRows.length} HTTP routes found — the route glob is broken`,
  )
  assert.ok(
    i.envNames.length >= 40,
    `only ${i.envNames.length} environment names found — the env scan is broken`,
  )
  assert.ok(
    i.allHosts.length >= 30,
    `only ${i.allHosts.length} declared egress hosts found — egressHosts parsing is broken`,
  )
  assert.ok(
    i.tools.length >= 1,
    'no Relay tool registration found — the module catalog contributes one and the parse missed it',
  )
})

test('every provider row cites a file and line that really says what it claims', () => {
  // Independent of the generator: the document says `provider-packs.ts:427`
  // declares `atlassian.jira`, so this opens that file at that line and looks.
  // A table assembled from the Bible's wording rather than from the tree passes
  // `--check` and dies here.
  const i = collect()
  const cached = new Map()
  const lines = (file) => {
    if (!cached.has(file)) cached.set(file, read(file).split('\n'))
    return cached.get(file)
  }

  const wrong = []
  for (const row of i.providerRows) {
    const body = lines(row.source)
    if (row.line < 1 || row.line > body.length) {
      wrong.push(`${row.key}: ${row.source}:${row.line} is past the end of the file`)
      continue
    }
    // The fields the row claims live within a small window of the cited line,
    // so a citation off by a whole block is caught. `keyLine` is checked
    // separately from `line` because a catalog entry declares its key well
    // above its capability array, and one window covering both would be wide
    // enough to swallow a neighbouring entry.
    // Tight windows, and they have to be tight: a citation is only a citation
    // if being wrong about it fails. A twenty-five-line window absorbs an
    // off-by-three line offset in the block scanner and lets a whole table of
    // slightly-wrong citations through. `key` is on the line after `pack({`
    // and ON `keyLine` for a catalog entry, so four lines covers both spellings
    // and nothing else; `provider` is three lines further down.
    const near = (at, span) => body.slice(at - 1, at + span).join('\n')
    if (row.key && !near(row.keyLine, 3).includes(row.key)) {
      wrong.push(`${row.key}: not found at ${row.source}:${row.keyLine}`)
    }
    if (row.provider && !near(row.line, 6).includes(`"${row.provider}"`)) {
      wrong.push(`${row.key}: provider "${row.provider}" not found at ${row.source}:${row.line}`)
    }
    for (const req of row.requirementIds) {
      if (!near(row.line, 25).includes(req)) {
        wrong.push(`${row.key}: requirement ${req} not found at ${row.source}:${row.line}`)
      }
    }
  }
  assert.deepEqual(wrong, [], `inventory rows cite text the tree does not contain:\n${wrong.join('\n')}`)
})

test('every path the inventory names exists', () => {
  const i = collect()
  const missing = []
  const check = (p) => {
    if (!fs.existsSync(path.join(ROOT, p))) missing.push(p)
  }
  for (const row of i.providerRows) check(row.source)
  for (const r of i.routeRows) check(r.file)
  for (const f of i.images) check(f)
  for (const s of i.surfaces) check(s.file)
  for (const c of i.credentials) check(c.file)
  for (const d of i.deps) check(d.manifest)
  for (const list of i.egress.values()) for (const s of list) check(s.file)
  assert.deepEqual(missing, [], `the inventory names paths that do not exist: ${missing.join(', ')}`)
})

test('the redirect matcher answers by segment, not by prefix', () => {
  // The falsifier column in §2 and §5 rests entirely on this. A prefix match
  // would report every pack's callback as served by `/api/connections/opportunity`,
  // which would turn "no declared pack can be authorized today" into "all of
  // them can" without a line of connector code being written.
  assert.equal(servesPath('/api/connections/[key]/callback', '/api/connections/slack.workspace/callback'), true)
  assert.equal(servesPath('/api/connections/opportunity', '/api/connections/slack.workspace/callback'), false)
  assert.equal(servesPath('/api/connections', '/api/connections/slack.workspace/callback'), false)
  assert.equal(servesPath('/api/connections/opportunity', '/api/connections/opportunity'), true)
})

test('the two false positives the first run produced stay dead', () => {
  const i = collect()
  const box = i.perProvider.find((p) => p.provider === 'box')
  const adobe = i.perProvider.find((p) => p.provider === 'adobe')
  assert.ok(box && adobe, 'box and adobe are declared packs and must both be present')

  // `/api/jobs/outbox` is a scheduler endpoint. It became "Box has a route" on
  // the first run, and a provider with a route reads as a provider with a
  // connector.
  assert.ok(
    i.routeRows.some((r) => r.route === '/api/jobs/outbox'),
    'the fixture route this pins has been renamed — re-derive the case before deleting it',
  )
  assert.deepEqual(box.providerRoutes, [], 'Box has no route; `outbox` is not one')

  // `@aws-sdk/s3-request-presigner` contains `Sign`, which the display name
  // `Adobe Acrobat Sign` contributed as a match token on the first run.
  assert.ok(
    i.deps.some((d) => d.name === '@aws-sdk/s3-request-presigner'),
    'the fixture dependency this pins is gone — re-derive the case before deleting it',
  )
  assert.deepEqual(adobe.sdks, [], 'Adobe has no SDK; `s3-request-presigner` is not one')
})

test('a mention in the credential plane is not counted as a stored token', () => {
  // Two real matches in the tree are an English weekday inside a cron
  // explanation (`monday`) and a leak-detector regex for a provider token
  // format (`slack`). Counting either as a stored credential would put a `1` in
  // the token column for a provider with no connector at all.
  const i = collect()
  const mentions = i.credentials.filter((c) => !c.broker && c.providers.length > 0)
  assert.ok(
    mentions.length > 0,
    'no non-broker credential-plane mention found — the case this distinguishes has vanished; re-derive it',
  )
  for (const m of mentions) {
    for (const provider of m.providers) {
      const row = i.perProvider.find((p) => p.provider === provider)
      assert.deepEqual(
        row.tokenSites.filter((f) => f === m.file),
        [],
        `${m.file} merely mentions "${provider}" and is being counted as a stored token for it`,
      )
    }
  }
})

test('the generated inventory does not become an authority in the document graph', () => {
  // This is not hypothetical. The first version of the generated document said
  // "invariant 3 of the Bible" in its prose, `tools/document-graph.mjs`
  // classifies any markdown whose first 4000 characters contain `Bible` as an
  // AUTHORITY, and the document also restates `**WRK-000-001** — inventory
  // every…` in the exact shape `requirementsIn` reads as a STATEMENT. The
  // consequence was that the capability registry recorded a generated
  // inventory as the source document for WRK-000-001 instead of the Bible that
  // states it — and, worse, `document-graph.yaml` became stale the moment this
  // file was written, which reds `document-graph.test.mjs` for every other
  // domain working in the same tree.
  //
  // Asserted against `classify()` itself rather than against a copy of the
  // marker list, so this cannot drift from the rule it is protecting.
  const inGraph = classify().filter((d) => d.canonical_path === OUT)
  assert.deepEqual(
    inGraph.map((d) => `${d.canonical_path} (${d.role})`),
    [],
    `${OUT} is a DERIVED document. Entering the document graph makes it compete with the ` +
      `authority for ownership of the requirements it merely reports on.`,
  )
})

test('this file is testing the generator that wrote the committed document', () => {
  // Cheap, and it catches the rename that would otherwise make every assertion
  // above green against a document nobody reads.
  assert.equal(OUT, 'docs/architecture/wrk-work-graph-inventory.md')
  assert.ok(fs.existsSync(path.join(ROOT, OUT)), `${OUT} is not committed`)
  assert.equal(
    path.resolve(ROOT),
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'),
    'the generator and this test disagree about where the repository root is',
  )
})
