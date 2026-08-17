/**
 * The integration plane's ownership and its write boundary, enforced.
 *
 * The integration Bible asks (INT-000-004) for domain ownership to be
 * established and for direct connector table writes to be prohibited, and states
 * the prohibition as an invariant in §2: "No connector can directly write private
 * domain tables or post ledger rows. It invokes authorized typed commands."
 * `tools/int-connector-write-boundary.mjs` computes both from the tree; this
 * checks the computation, in the two ways that can be wrong.
 *
 * **Stale.** The committed document no longer matches the code. Caught by
 * `--check`, which is a byte comparison.
 *
 * **Current and false.** The document matches what the generator says, and the
 * generator is wrong — a detector that matches nothing reports a clean boundary
 * for a repository that has none. That is the failure mode this file spends most
 * of its length on: every plane member, every write and every ingress point is
 * re-derived here through `git grep` and the ownership map, by code that shares
 * nothing with the generator, and every detector is additionally proven against
 * an assembled fixture so that none of them can pass by matching nothing.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

import {
  COMMAND_BUS,
  authenticatesProvider,
  OUT,
  PLANE_OWNED_MODELS,
  ROOT,
  SCHEMA,
  collect,
  plane,
  productionSources,
  providerIngress,
  read,
  schemaModels,
  violations,
  writeHandles,
  writesIn,
} from '../../tools/int-connector-write-boundary.mjs'
import { classify } from '../../tools/ownership-map.mjs'

const doc = () => fs.readFileSync(path.join(ROOT, OUT), 'utf8').replace(/\r\n/g, '\n')

/**
 * git grep, returning `file:line:text` rows. Empty on no match, which git exits 1 for.
 *
 * `--untracked` is load-bearing and was found by a mutation. Without it git greps
 * the index only, so a brand-new connector file — the exact thing this boundary
 * has to catch on the commit that adds it — is invisible to the re-derivation
 * while the generator (which uses `git ls-files --others`) sees it. The two then
 * disagree in the direction that reads as "the generator invented a write".
 */
function gitGrep(pattern, ...pathspecs) {
  try {
    return execFileSync('git', ['grep', '-n', '--untracked', '-E', pattern, '--', ...pathspecs], {
      cwd: ROOT,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    })
      .split('\n')
      .filter(Boolean)
  } catch (err) {
    if (err.status === 1) return []
    throw err
  }
}

test('the committed document matches the tree', () => {
  const out = execFileSync('node', ['tools/int-connector-write-boundary.mjs', '--check'], {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: 'pipe',
  })
  assert.match(out, /up to date/)
})

test('every path the document cites exists', () => {
  const cited = [...doc().matchAll(/`((?:apps|packages|tools|tests|docs)\/[^`\s]+?)(?::\d+)?`/g)].map(
    (m) => m[1],
  )
  assert.ok(cited.length > 20, `only ${cited.length} paths cited — the document stopped naming files`)
  for (const p of new Set(cited)) {
    assert.ok(fs.existsSync(path.join(ROOT, p)), `${OUT} cites ${p}, which does not exist`)
  }
})

test('the plane is exactly the integrations domain plus the provider ingress', () => {
  // Re-derived here, not read from the generator: the ownership map's own
  // classification, and an independent grep for the header a webhook route must
  // read. If the generator's plane silently shrank to nothing, its "no
  // violation" finding would be true and meaningless.
  const { byDomain } = classify()
  const integrations = (byDomain.get('integrations') ?? []).filter(
    (f) => !/\.(test|itest)\.(ts|tsx)$/.test(f),
  )
  const ingress = gitGrep(
    '\\.headers\\.get\\(\\s*"[a-z0-9]+-signature"\\s*\\)',
    'apps/web/src',
    'apps/system-studio/src',
    'packages',
  ).map((row) => row.split(':')[0])

  assert.ok(integrations.length > 10, `the integrations domain owns ${integrations.length} production files`)
  assert.ok(ingress.length > 0, 'no provider ingress found — the ingress detector matches nothing')

  const expected = [...new Set([...integrations, ...ingress])].sort()
  const actual = plane(productionSources()).members.map((m) => m.file)
  assert.deepEqual(actual, expected)

  // And the document lists exactly those, so a reader of the document sees the
  // same plane the rules were applied to.
  const rows = [...doc().matchAll(/^\| `((?:apps|packages)\/[^`]+)` \| /gm)].map((m) => m[1])
  for (const f of expected) assert.ok(rows.includes(f), `${OUT} does not list plane module ${f}`)
})

test('every module in the plane is owned by exactly one domain', () => {
  const { byDomain, orphans, ambiguous } = classify()
  const members = plane(productionSources()).members
  const owners = new Map()
  for (const [domain, list] of byDomain) for (const f of list) owners.set(f, domain)

  for (const m of members) {
    assert.ok(m.owner !== null, `${m.file} is in the integration plane and no domain owns it`)
    assert.equal(m.owner, owners.get(m.file))
    assert.ok(!orphans.includes(m.file), `${m.file} is an orphan in the ownership map`)
    assert.ok(!ambiguous.includes(m.file), `${m.file} is claimed by two domains`)
  }
})

test('the plane writes exactly what the document says, re-derived independently', () => {
  const models = schemaModels()
  const properties = new Map(models.map((m) => [m.property, m.name]))
  const planeFiles = new Set(plane(productionSources()).members.map((m) => m.file))

  // A grep for every mutator on every handle, then filtered to the plane. The
  // generator strips comments and blanks strings; this does neither, so a row it
  // finds and the generator does not has to be explained rather than assumed —
  // which is why the assertion below is a superset check in that direction and
  // an exact check in the other.
  const rows = gitGrep(
    '\\b(db|tx|client|prisma)\\.[A-Za-z0-9_]+\\.(create|createMany|createManyAndReturn|update|updateMany|upsert|delete|deleteMany)\\b',
    'apps/web/src',
    'apps/system-studio/src',
    'packages',
  )
    // A comment is not code, decided line-first rather than by the generator's
    // block-comment regex so the two implementations disagree by construction.
    // This is not hypothetical: `apps/web/src/app/api/ai/chat/route.ts` explains
    // that audit rows go through `recordAuditEvent` and "never
    // `db.auditEvent.create`" — a sentence a raw grep reports as the assistant
    // route writing the audit trail.
    .filter((row) => {
      const text = row.split(':').slice(2).join(':')
      const trimmed = text.trimStart()
      if (/^(\/\/|\*|\/\*)/.test(trimmed)) return false
      // Inside backticks is prose about a call, not a call.
      return !/`[^`]*\b(?:db|tx|client|prisma)\.[A-Za-z0-9_]+\.[A-Za-z]+[^`]*`/.test(text)
    })
    .map((row) => {
      const [file, line, ...rest] = row.split(':')
      const text = rest.join(':')
      const m = text.match(
        /\b(?:db|tx|client|prisma)\.([A-Za-z0-9_]+)\.(create|createMany|createManyAndReturn|update|updateMany|upsert|delete|deleteMany)\b/,
      )
      return { file, line: Number(line), model: properties.get(m[1]) ?? null, mutator: m[2] }
    })
    .filter((r) => r.model !== null)
    .filter((r) => planeFiles.has(r.file))
    .filter((r) => !/\.(test|itest)\.(ts|tsx)$/.test(r.file))

  const generated = collect().planeWrites.filter((w) => w.model !== null)

  // Every write the generator reports is a write this grep also sees.
  for (const w of generated) {
    assert.ok(
      rows.some((r) => r.file === w.file && r.line === w.line && r.model === w.model),
      `${OUT} reports ${w.file}:${w.line} ${w.model}.${w.mutator}, which an independent grep does not see`,
    )
  }
  // And the generator has not lost one this grep sees except through comment or
  // string blanking, which is a claim, so any difference is named.
  const missed = rows.filter(
    (r) => !generated.some((w) => w.file === r.file && w.line === r.line && w.model === r.model),
  )
  assert.deepEqual(
    missed.map((r) => `${r.file}:${r.line} ${r.model}.${r.mutator}`),
    [],
    'the generator does not report these writes, and they are not in a comment or a string',
  )

  assert.ok(generated.length > 0, 'the plane issues no writes at all — the scanner sees nothing')
})

test('the boundary forbids models the schema actually declares', () => {
  // Non-vacuity. "No violation" is only worth reading if the forbidden set
  // contains the tables the Bible names — the ledger and the audit trail. A
  // boundary around an empty set is not a boundary.
  const declared = new Set(schemaModels().map((m) => m.name))
  for (const model of ['LedgerEntry', 'AuditEvent', 'Transaction', 'Settlement', 'ApprovalRequest']) {
    assert.ok(declared.has(model), `${SCHEMA} no longer declares ${model}`)
    assert.ok(
      !Object.keys(PLANE_OWNED_MODELS).includes(model),
      `${model} was added to the models the integration plane may write directly`,
    )
  }
  assert.ok(declared.size > 40, `only ${declared.size} models parsed out of the schema`)
  for (const owned of Object.keys(PLANE_OWNED_MODELS)) {
    assert.ok(declared.has(owned), `the plane claims to own ${owned}, which the schema does not declare`)
  }
})

test('the outbound rule fires on a domain-table write', () => {
  // The detector, against text rather than against the tree, so the branch is
  // reachable without editing a real connector. `LedgerEntry` is the exact case
  // the Bible's invariant names.
  const found = writesIn('await db.ledgerEntry.create({ data: row })\n', schemaModels())
  assert.deepEqual(found, [{ model: 'LedgerEntry', mutator: 'create', line: 1 }])

  const v = violations({
    outbound: [{ file: 'apps/web/src/lib/connections/x.ts', line: 1, model: 'LedgerEntry', mutator: 'create' }],
    rawSql: [],
    inbound: [],
    unowned: [],
  })
  assert.equal(v.length, 1)
  assert.equal(v[0].rule, 'outbound')
  assert.match(v[0].what, /LedgerEntry/)
})

test('the inbound rule fires on a plane-owned write from outside the plane', () => {
  const v = violations({
    outbound: [],
    rawSql: [],
    inbound: [
      { file: 'apps/web/src/lib/finance.ts', line: 9, model: 'ProviderEventReceipt', mutator: 'create' },
    ],
    unowned: [],
  })
  assert.equal(v.length, 1)
  assert.equal(v[0].rule, 'inbound')
  assert.match(v[0].what, /from outside the integration plane/)
})

test('raw SQL from inside the plane is a violation, and an unowned plane module is one', () => {
  const raw = writesIn('await db.$executeRawUnsafe(sql)\n', schemaModels())
  assert.deepEqual(raw, [{ model: null, mutator: 'raw-sql', line: 1 }])

  const v = violations({
    outbound: [],
    rawSql: raw.map((r) => ({ file: 'apps/web/src/lib/relay/x.ts', ...r })),
    inbound: [],
    unowned: [{ file: 'apps/web/src/lib/connections/orphan.ts', owner: null, why: 'integrations domain' }],
  })
  assert.deepEqual(v.map((x) => x.rule).sort(), ['no-raw-sql', 'ownership'])
})

test('the write detector reads code and not prose or permission strings', () => {
  const models = schemaModels()
  // A write in a line comment is not a write. `outbox.ts` genuinely documents
  // itself with one, and counting it made the outbox write itself.
  assert.deepEqual(writesIn('// db.outboxEvent.create({ data })\n', models), [])
  assert.deepEqual(writesIn('/* spread into db.outboxEvent.create() */\n', models), [])
  // A permission string is not a write. `finance.budget.update` is a permission
  // this repository really uses, and `budget` really is a model property.
  assert.deepEqual(writesIn('await require(userId, "finance.budget.update")\n', models), [])
  // And it still sees the real thing on a line that has a string on it.
  assert.deepEqual(writesIn('await db.budget.update({ where: { id: "b-1" } })\n', models), [
    { model: 'Budget', mutator: 'update', line: 1 },
  ])
  // A read is not a write.
  assert.deepEqual(writesIn('await db.ledgerEntry.findMany({})\n', models), [])
})

test('the ingress detector matches a webhook route and not the verifier it calls', () => {
  // Over text, never by writing a probe file into the tree:
  // `tests/architecture/guards-do-not-write-into-the-tree.test.mjs` forbids that,
  // and for a good reason — the suite runs in parallel and a file that exists for
  // 200ms makes every other guard's view of the repository briefly false.
  assert.equal(
    authenticatesProvider('const signature = request.headers.get("stripe-signature") ?? ""\n'),
    true,
    'the ingress detector does not match a webhook route',
  )
  assert.equal(
    authenticatesProvider("const signature = request.headers.get('stripe-signature') ?? ''\n"),
    true,
    'the ingress detector is defeated by single quotes',
  )
  assert.equal(
    authenticatesProvider('export function verifySignature(raw: string, header: string) {\n'),
    false,
    'the ingress detector matches the verifier definition site',
  )
  // And the real tree still has one, so the detector is not passing by matching nothing.
  assert.ok(providerIngress(productionSources()).length > 0, 'no provider ingress in the tree')
})

test('no handle carries a model write past the scanner', () => {
  const handles = writeHandles(productionSources(), schemaModels())
  const known = ['db', 'tx', 'client', 'prisma']
  const unknown = handles.filter((h) => !known.includes(h))
  assert.deepEqual(
    unknown,
    [],
    `these handles carry Prisma model writes and the scanner does not know them: ${unknown.join(', ')}. ` +
      `Add them to MUTATORS' handle list in tools/int-connector-write-boundary.mjs.`,
  )
  assert.ok(handles.includes('db'), 'no write through `db` anywhere — the handle scan sees nothing')
})

test('the typed-command door the boundary points at exists', () => {
  // The prohibition is only a boundary if there is a way through it. A document
  // that told connectors to dispatch a command that did not exist would be
  // describing a dead end.
  assert.ok(fs.existsSync(path.join(ROOT, COMMAND_BUS)), `${COMMAND_BUS} is missing`)
  assert.match(read(COMMAND_BUS), /export async function dispatch\b/)
})

test('the boundary is clean right now', () => {
  const v = violations()
  assert.deepEqual(v.map((x) => `${x.rule}: ${x.what}`), [])
})

test('the generated document does not take a requirement away from the Bible', () => {
  // The trap this repository has already been caught by: a generated ANSWER that
  // opens `**INT-000-004** — …` is read by tools/document-graph.mjs as the
  // document STATING the requirement, and `classify()` sorts docs/ ahead of the
  // Bible. The answer then owns the requirement and the queue prints this file's
  // prose instead of the Bible's sentence.
  for (const line of doc().split('\n')) {
    assert.doesNotMatch(
      line,
      /^\**[A-Z]{2,8}-(?:\d{3}-\d{3}|GATE-\d+)\**\s+—/,
      `${OUT} states a requirement id at the start of a line: ${line}`,
    )
  }
})
