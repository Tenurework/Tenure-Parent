/**
 * WRK-000-004 — the Work Graph authority bindings are checkable in both
 * directions.
 *
 * A mapping is a claim that two things correspond, and the difference between a
 * mapping and a paragraph is whether anything reds when one side gains an entry
 * the other lacks. So this compares the binding table against the requirement's
 * OWN statement in both directions — drop a binding and it fails, invent a
 * ninth and it fails — and then opens every path the table names.
 *
 * The failure this is really aimed at is the plausible document: a table of
 * eight counterpart names assembled from the requirement's wording, describing
 * documents, ledgers and modules nobody has. It is trivially detected by
 * opening one path, so this opens all of them, and additionally requires each
 * governing document to be an AUTHORITY in the generated document graph
 * carrying the prefix the row claims — a real file with the wrong prefix is
 * still a wrong binding.
 *
 * Plain `node --test` — this directory is run by `npm run test:platform`, which
 * has no TypeScript and no jest globals.
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'

import { classify, ledgerStatuses } from '../../tools/document-graph.mjs'
import {
  BINDINGS,
  OUT,
  ROOT,
  WRK_DOC,
  WRK_LEDGER,
  namedBindings,
  resolvedReadOrder,
} from '../../tools/wrk-authority-bindings.mjs'

const abs = (p) => path.join(ROOT, p)

test('the committed binding document matches its generator', () => {
  const result = execFileSync(
    process.execPath,
    [abs('tools/wrk-authority-bindings.mjs'), '--check'],
    { cwd: ROOT, encoding: 'utf8' },
  )
  assert.match(result, /is up to date/)
})

test('the bindings are exactly the ones WRK-000-004 names', () => {
  // Both directions. The requirement's statement is the authority for this
  // list, and it is parsed from the document rather than transcribed, so a
  // table that quietly drops `lifecycle` — or adds a ninth binding nobody
  // asked for — cannot pass.
  const named = namedBindings().sort()
  const bound = BINDINGS.map((b) => b.name).sort()

  assert.ok(named.length >= 8, `only ${named.length} bindings parsed from WRK-000-004 — the parse is broken`)
  assert.deepEqual(
    named.filter((n) => !bound.includes(n)),
    [],
    'WRK-000-004 names a binding that has no row in the binding table.',
  )
  assert.deepEqual(
    bound.filter((n) => !named.includes(n)),
    [],
    'The binding table carries a binding WRK-000-004 does not name. An invented counterpart is a ' +
      'correspondence nobody can re-derive.',
  )
})

test('every path the binding table names exists', () => {
  const missing = []
  for (const b of BINDINGS) {
    for (const p of [...b.documents, ...b.ledgers, ...b.code]) {
      if (!fs.existsSync(abs(p))) missing.push(`${b.name}: ${p}`)
    }
  }
  assert.deepEqual(missing, [], `the binding table names paths that do not exist:\n${missing.join('\n')}`)
})

test('every governing document is an authority in the document graph, with the prefix its row claims', () => {
  // A real file with the wrong prefix is still a wrong binding: it would send a
  // reader looking for `INT-*` requirements to a document that states `PAY-*`.
  const graph = new Map(classify().map((d) => [d.canonical_path, d]))
  const wrong = []
  for (const b of BINDINGS) {
    for (const doc of b.documents) {
      const entry = graph.get(doc)
      if (!entry) {
        wrong.push(`${b.name}: ${doc} is not in the document graph`)
        continue
      }
      if (entry.role !== 'authority') {
        wrong.push(`${b.name}: ${doc} is a ${entry.role}, not an authority`)
      }
      const shared = b.prefixes.filter((p) => entry.requirement_prefixes.includes(p))
      if (shared.length === 0) {
        wrong.push(
          `${b.name}: ${doc} carries prefixes [${entry.requirement_prefixes.join(', ')}], none of the ` +
            `[${b.prefixes.join(', ')}] this row claims`,
        )
      }
    }
  }
  assert.deepEqual(wrong, [], `binding rows disagree with the document graph:\n${wrong.join('\n')}`)
})

test('the Relay row states an absence rather than inventing a document', () => {
  // The fabrication this programme fails on is the plausible name. There is no
  // Relay authority in this repository; the honest row has no document and says
  // so. If somebody later adds one, this fails and asks for the row to be
  // filled in — which is the right direction to fail in.
  const relay = BINDINGS.find((b) => b.name === 'Relay')
  assert.ok(relay, 'WRK-000-004 names Relay and the table must carry it')
  assert.deepEqual(relay.documents, [], 'the Relay row must not name a document')
  const relayish = classify().filter(
    (d) => /relay/i.test(path.basename(d.canonical_path)) && d.role === 'authority',
  )
  assert.deepEqual(
    relayish.map((d) => d.canonical_path),
    [],
    'a Relay authority now exists in the graph — the binding row must name it instead of recording its absence',
  )
})

test('every requirement the boundaries cite is a real requirement of its domain', () => {
  const ledger = ledgerStatuses()
  const bad = []
  for (const b of BINDINGS) {
    for (const id of b.wrkRequirements) {
      const row = ledger.get(id)
      if (!row) {
        bad.push(`${b.name}: ${id} is in no execution ledger`)
        continue
      }
      if (row.source_ledger !== WRK_LEDGER) {
        bad.push(`${b.name}: ${id} is filed in ${row.source_ledger}, not the work-graph ledger`)
      }
    }
  }
  assert.deepEqual(bad, [], `the binding table cites requirements that do not resolve:\n${bad.join('\n')}`)
})

test('the read-order contract is resolved entry by entry, and the unresolvable one is named', () => {
  const order = resolvedReadOrder()
  assert.equal(order.length, 8, `section 0 of ${WRK_DOC} lists ${order.length} read-order entries, not 8`)

  const unresolved = order.filter((e) => !e.resolved)
  assert.deepEqual(
    unresolved.map((e) => `#${e.n} ${e.title}`),
    [],
    'a read-order entry resolves to nothing at all — it must resolve to a file or be recorded as absent',
  )

  // Entry 8 names "Tenure Major App and Industry Connector Catalog and
  // Certification Matrix". No file in this repository carries that title, and
  // the phrase appears nowhere except the read-order line itself. Recorded as
  // absent rather than mapped onto the nearest-sounding document — the
  // Connection Composer authority is a different document with a different
  // title, and binding to it would be an invented correspondence.
  const absent = order.filter((e) => e.file === null && e.note?.startsWith('NOT PRESENT'))
  assert.equal(absent.length, 1, 'exactly one read-order entry is absent from this repository')
  assert.equal(absent[0].n, 8)
  const phrase = 'Major App and Industry Connector Catalog'
  const hits = execFileSync('git', ['grep', '-l', '-F', phrase, '--', '*.md'], {
    cwd: ROOT,
    encoding: 'utf8',
  })
    .split('\n')
    .filter(Boolean)
    // The two documents that exist to RECORD the absence necessarily quote the
    // title. Excluding them keeps this an assertion about whether the document
    // arrived, rather than one that reds the moment somebody writes down that
    // it has not.
    .filter((f) => f !== OUT && f !== WRK_LEDGER)
  assert.deepEqual(
    hits,
    [WRK_DOC],
    `"${phrase}" now appears outside its own read-order line — the absence this records may have been resolved`,
  )

  for (const e of order.filter((x) => x.file)) {
    assert.ok(fs.existsSync(abs(e.file)), `read-order #${e.n} resolves to a missing file: ${e.file}`)
  }
})

test('the generated binding document does not become an authority in the document graph', () => {
  // Same trap the inventory fell into: `tools/document-graph.mjs` classifies any
  // markdown whose name or first 4000 characters carry an authority marker as an
  // AUTHORITY, and a derived document that enters the graph competes with the
  // real authority for ownership of the requirements it merely reports on. This
  // document quotes section 0 — which contains the word — so the quotation is
  // kept below that window deliberately, and this is what holds it there.
  const inGraph = classify().filter((d) => d.canonical_path === OUT)
  assert.deepEqual(
    inGraph.map((d) => `${d.canonical_path} (${d.role})`),
    [],
    `${OUT} is a DERIVED document and must not enter the document graph.`,
  )
})
